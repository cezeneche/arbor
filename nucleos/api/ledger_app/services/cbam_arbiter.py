from __future__ import annotations

from copy import deepcopy
from datetime import date
import re
from typing import Any

# Keyword proximity scoring thresholds (character distance in source text).
# Within _PROXIMITY_CLOSE characters of a keyword → strong signal (2.0 bonus).
# Within _PROXIMITY_MEDIUM characters of a keyword → weak signal (1.0 bonus).
_PROXIMITY_CLOSE = 40
_PROXIMITY_MEDIUM = 120


def _layout_text(layout: dict[str, Any] | None, zone: str) -> str:
    if not isinstance(layout, dict):
        return ""

    direct = layout.get(zone)
    if isinstance(direct, str):
        return direct.strip()
    if isinstance(direct, list):
        joined = " ".join(
            str(item.get("text", "")).strip() if isinstance(item, dict) else str(item).strip()
            for item in direct
        ).strip()
        if joined:
            return joined

    blocks = layout.get("blocks")
    if isinstance(blocks, list):
        joined = " ".join(
            str(block.get("text", "")).strip()
            for block in blocks
            if isinstance(block, dict) and str(block.get("type", "")).strip().lower() == zone
        ).strip()
        if joined:
            return joined
    return ""


def _full_text(candidate: dict[str, Any]) -> str:
    for key in ("full_text", "raw_text", "raw_text_preview"):
        value = candidate.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def _field_value(candidate: dict[str, Any], field: str) -> Any:
    invoice = candidate.get("invoice")
    if isinstance(invoice, dict):
        return invoice.get(field)
    return None


def _is_iso_date(value: str | None) -> bool:
    if not value or not isinstance(value, str):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def _keyword_proximity_score(text: str, value: str, keywords: list[str]) -> float:
    lowered_text = text.lower()
    lowered_value = value.lower()
    value_idx = lowered_text.find(lowered_value)
    if value_idx < 0:
        return 0.0

    best_distance: int | None = None
    for keyword in keywords:
        idx = lowered_text.find(keyword.lower())
        if idx < 0:
            continue
        distance = abs(value_idx - idx)
        if best_distance is None or distance < best_distance:
            best_distance = distance

    if best_distance is None:
        return 0.0
    if best_distance <= _PROXIMITY_CLOSE:
        return 2.0
    if best_distance <= _PROXIMITY_MEDIUM:
        return 1.0
    return 0.0


def _score_field_value(field: str, value: Any, candidate: dict[str, Any]) -> float:
    if value is None:
        return 0.0
    value_text = str(value).strip()
    if not value_text:
        return 0.0

    score = 1.0
    header_text = _layout_text(candidate.get("layout") if isinstance(candidate.get("layout"), dict) else None, "header")
    full_text = _full_text(candidate)

    if field in {"invoice_number", "invoice_date"} and value_text.lower() in header_text.lower():
        score += 3.0

    if field == "invoice_number":
        score += _keyword_proximity_score(full_text, value_text, ["invoice", "invoice number", "invoice no"])
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9\-_\/]+", value_text):
            score += 1.0
    elif field == "invoice_date":
        score += _keyword_proximity_score(full_text, value_text, ["date", "invoice date"])
        if _is_iso_date(value_text):
            score += 2.0
    elif field == "origin_country":
        if re.fullmatch(r"[A-Za-z]{2}", value_text):
            score += 1.0
    elif field == "incoterm":
        if re.fullmatch(r"[A-Za-z]{3}", value_text):
            score += 1.0

    return score


def _normalize_lines(lines: Any) -> list[dict[str, Any]]:
    if not isinstance(lines, list):
        return []
    return [line for line in lines if isinstance(line, dict)]


def _line_rows_detected(text: str) -> int:
    if not text:
        return 0
    return len(re.findall(r"^\s*Line\s+\d+\s*:", text, flags=re.IGNORECASE | re.MULTILINE))


def _score_lines(lines: list[dict[str, Any]], candidate: dict[str, Any]) -> float:
    if not lines:
        return 0.0

    body_text = _layout_text(candidate.get("layout") if isinstance(candidate.get("layout"), dict) else None, "body")
    full_text = _full_text(candidate)

    score = float(len(lines))
    total_mass = 0.0
    for line in lines:
        cn_code = str(line.get("cn_code") or "").strip()
        if re.fullmatch(r"\d{6}", cn_code):
            score += 1.0
        if cn_code and body_text and cn_code in body_text:
            score += 2.0

        quantity = line.get("net_mass_kg")
        if quantity is None:
            quantity = line.get("quantity")
        try:
            numeric = float(quantity) if quantity is not None else 0.0
        except (TypeError, ValueError):
            numeric = 0.0
        if numeric > 0:
            score += 1.0
            total_mass += numeric

    detected_rows = _line_rows_detected(body_text) or _line_rows_detected(full_text)
    if detected_rows and detected_rows == len(lines):
        score += 2.0
    if total_mass > 0:
        score += 1.0
    return score


def _pick_field(
    field: str,
    candidates: list[dict[str, Any]],
    warnings: list[str],
) -> Any:
    values_by_source: list[tuple[str, Any, dict[str, Any]]] = []
    for candidate in candidates:
        source = str(candidate.get("source") or "unknown")
        values_by_source.append((source, _field_value(candidate, field), candidate))

    non_null = [(source, value, candidate) for source, value, candidate in values_by_source if value not in (None, "")]
    unique_values = {str(value) for _, value, _ in non_null}

    if not non_null:
        return None
    if len(unique_values) == 1:
        return non_null[0][1]

    best_source = non_null[0][0]
    best_value = non_null[0][1]
    best_score = _score_field_value(field, best_value, non_null[0][2])
    for source, value, candidate in non_null[1:]:
        score = _score_field_value(field, value, candidate)
        if score > best_score:
            best_source = source
            best_value = value
            best_score = score

    conflict_sources = sorted({source for source, _, _ in non_null})
    warnings.append(f"arbiter_conflict:{field}:{'!='.join(conflict_sources)}")
    return best_value


def _pick_lines(candidates: list[dict[str, Any]], warnings: list[str]) -> list[dict[str, Any]]:
    options: list[tuple[str, list[dict[str, Any]], dict[str, Any]]] = []
    for candidate in candidates:
        source = str(candidate.get("source") or "unknown")
        lines = _normalize_lines(candidate.get("lines"))
        options.append((source, lines, candidate))

    non_empty = [(source, lines, candidate) for source, lines, candidate in options if lines]
    if not non_empty:
        return []

    normalized_sets = {
        tuple((str(line.get("cn_code")), str(line.get("quantity")), str(line.get("net_mass_kg"))) for line in lines)
        for _, lines, _ in non_empty
    }
    if len(normalized_sets) == 1:
        return deepcopy(non_empty[0][1])

    best_source, best_lines, best_candidate = non_empty[0]
    best_score = _score_lines(best_lines, best_candidate)
    for source, lines, candidate in non_empty[1:]:
        score = _score_lines(lines, candidate)
        if score > best_score:
            best_source, best_lines, best_candidate = source, lines, candidate
            best_score = score

    conflict_sources = sorted({source for source, _, _ in non_empty})
    warnings.append(f"arbiter_conflict:lines:{'!='.join(conflict_sources)}")
    return deepcopy(best_lines)


def _merge_candidate_evidence(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for candidate in candidates:
        evidence = candidate.get("evidence")
        if not isinstance(evidence, list):
            continue
        for atom in evidence:
            if not isinstance(atom, dict):
                continue
            key = (
                str(atom.get("field")),
                str(atom.get("value")),
                str(atom.get("source")),
                str(atom.get("page")),
            )
            if key in seen:
                continue
            seen.add(key)
            merged.append(deepcopy(atom))
    return merged


def arbitrate_parsed_invoice(candidates: list[dict]) -> tuple[dict, list[str]]:
    """
    Arbitrate conflicting parsed candidates into a single best invoice draft.
    """
    normalized_candidates = [c for c in candidates if isinstance(c, dict)]
    if not normalized_candidates:
        return {}, ["arbiter_no_candidates"]

    warnings: list[str] = []
    merged = deepcopy(normalized_candidates[0])
    merged.setdefault("invoice", {})
    merged.setdefault("lines", [])

    invoice = merged["invoice"]
    if not isinstance(invoice, dict):
        invoice = {}
        merged["invoice"] = invoice

    for field in ("invoice_number", "invoice_date", "origin_country", "incoterm"):
        invoice[field] = _pick_field(field, normalized_candidates, warnings)

    merged["lines"] = _pick_lines(normalized_candidates, warnings)
    merged["evidence"] = _merge_candidate_evidence(normalized_candidates)

    return merged, warnings


def validate_consignment_consistency(shipments: list[dict[str, Any]]) -> list[str]:
    """
    Validate that all shipments sharing the same consignment_reference have
    identical origin_country and import_date values.

    This enforces the UK HMRC requirement that a consignment (identified by
    its customs entry / ENS reference) is a single customs declaration with
    one country of origin and one import date.

    Args:
        shipments: list of shipment dicts, each expected to contain
                   ``consignment_reference``, ``origin_country``, and
                   ``import_date`` keys.  Shipments where
                   ``consignment_reference`` is None/empty are ignored.

    Returns:
        List of warning strings.  Empty list means no conflicts.
        Warning format:
          ``consignment_conflict:origin_country:ref=<ref>:countries=<a,b>``
          ``consignment_conflict:import_date:ref=<ref>:dates=<a,b>``
    """
    from collections import defaultdict

    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for s in shipments:
        ref = s.get("consignment_reference")
        if ref:
            groups[str(ref)].append(s)

    warnings: list[str] = []
    for ref, group in groups.items():
        if len(group) < 2:
            continue

        countries = {
            str(s["origin_country"])
            for s in group
            if s.get("origin_country") is not None
        }
        dates = {
            str(s["import_date"])
            for s in group
            if s.get("import_date") is not None
        }

        if len(countries) > 1:
            warnings.append(
                f"consignment_conflict:origin_country:ref={ref}:"
                f"countries={','.join(sorted(countries))}"
            )
        if len(dates) > 1:
            warnings.append(
                f"consignment_conflict:import_date:ref={ref}:"
                f"dates={','.join(sorted(dates))}"
            )

    return warnings
