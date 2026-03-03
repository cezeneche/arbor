from __future__ import annotations

import datetime
import json
import os
import re
from pathlib import Path
from typing import Any
from typing import Callable
from typing import Protocol

from ledger_app.schemas.evidence import EvidenceAtom
from ledger_app.schemas.evidence import EvidenceBBox
from ledger_app.schemas.evidence import EvidenceSpan


class CBAMExtractor(Protocol):
    def extract(
        self,
        file_path: str,
        layout: dict[str, Any] | None = None,
        pages: list[dict[str, Any]] | None = None,
    ) -> dict:
        ...


def _parse_number(text: str | None) -> float | None:
    if text is None:
        return None
    cleaned = text.replace(",", "").strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _normalize_method(value: str | None) -> str | None:
    if not value:
        return None
    lowered = value.strip().lower().replace("_", " ").replace("-", " ")
    if "actual" in lowered:
        return "actual"
    if "estimated" in lowered or "estimate" in lowered:
        return "estimated"
    if "default" in lowered:
        return "default"
    return None


# ── Field validators ──────────────────────────────────────────────────────────

_INCOTERM_WHITELIST: frozenset[str] = frozenset(
    {"EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"}
)


def _valid_incoterm(v: Any) -> bool:
    return isinstance(v, str) and v.strip().upper() in _INCOTERM_WHITELIST


def _valid_iso2(v: Any) -> bool:
    return isinstance(v, str) and bool(re.fullmatch(r"[A-Z]{2}", v.strip()))


def _valid_eori(v: Any) -> bool:
    return isinstance(v, str) and bool(re.fullmatch(r"[A-Z]{2}\d{6,}", v.strip()))


def _valid_cn_code(v: Any) -> bool:
    return isinstance(v, str) and bool(re.fullmatch(r"\d{6,8}", v.strip()))


def _valid_mass(v: Any) -> bool:
    try:
        return float(v) > 0
    except (TypeError, ValueError):
        return False


def _valid_date(v: Any) -> bool:
    if not isinstance(v, str):
        return False
    s = v.strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return False
    try:
        datetime.date.fromisoformat(s)
        return True
    except ValueError:
        return False


_FIELD_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "incoterm": _valid_incoterm,
    "origin_country": _valid_iso2,
    "importer_eori": _valid_eori,
    "cn_code": _valid_cn_code,
    "invoice_date": _valid_date,
}

_FIELD_VALIDATOR_REASONS: dict[str, str] = {
    "incoterm": "not in Incoterms 2020 whitelist",
    "origin_country": "not a valid ISO-3166-1 alpha-2 code",
    "importer_eori": r"does not match EORI format [A-Z]{2}\d{6,}",
    "cn_code": "not a 6-8 digit numeric CN code",
    "invoice_date": "not a valid YYYY-MM-DD date",
}


def _validate_deterministic_fields(
    structured: dict[str, Any],
    flags: list[dict[str, Any]],
) -> None:
    """Validate regex-extracted fields in-place; clear invalids and record flags."""
    for field, validator in _FIELD_VALIDATORS.items():
        val = structured.get(field)
        if val is not None and not validator(val):
            flags.append(
                {
                    "field": field,
                    "issue": "deterministic_validation_failed",
                    "value": val,
                    "reason": _FIELD_VALIDATOR_REASONS[field],
                    "source": "regex",
                }
            )
            structured[field] = None

    mass = structured.get("net_mass_kg")
    if mass is not None and not _valid_mass(mass):
        flags.append(
            {
                "field": "net_mass_kg",
                "issue": "deterministic_validation_failed",
                "value": mass,
                "reason": "not a positive numeric mass",
                "source": "regex",
            }
        )
        structured["net_mass_kg"] = None


# ── Layout / evidence helpers ─────────────────────────────────────────────────


def _layout_text(layout: dict[str, Any] | None, zone: str) -> str:
    if not isinstance(layout, dict):
        return ""

    direct_value = layout.get(zone)
    if isinstance(direct_value, str):
        return direct_value.strip()
    if isinstance(direct_value, list):
        joined = " ".join(
            str(item.get("text", "")).strip() if isinstance(item, dict) else str(item).strip()
            for item in direct_value
        ).strip()
        if joined:
            return joined

    blocks = layout.get("blocks")
    if isinstance(blocks, list):
        zone_text = " ".join(
            str(block.get("text", "")).strip()
            for block in blocks
            if isinstance(block, dict) and str(block.get("type", "")).strip().lower() == zone
        ).strip()
        if zone_text:
            return zone_text

    if zone in {"full", "full_text", "raw_text"}:
        fallback = layout.get("full_text") or layout.get("raw_text")
        if isinstance(fallback, str):
            return fallback.strip()

    return ""


def _snippet_from_span(text: str, start: int, end: int, radius: int = 40) -> str:
    safe_start = max(start, 0)
    safe_end = max(end, safe_start)
    left = max(0, safe_start - radius)
    right = min(len(text), safe_end + radius)
    return text[left:right].strip()


def _normalize_token(value: str) -> str:
    return re.sub(r"[^a-z0-9\-_\/]", "", value.lower())


def _find_page_bbox_for_value(
    pages: list[dict[str, Any]] | None,
    value: Any,
) -> tuple[int | None, dict[str, float] | None]:
    if not isinstance(pages, list) or value in (None, ""):
        return None, None

    target = _normalize_token(str(value))
    if not target:
        return None, None

    for page in pages:
        if not isinstance(page, dict):
            continue
        page_number = page.get("page_number")
        words = page.get("words")
        if not isinstance(words, list):
            continue
        for word in words:
            if not isinstance(word, dict):
                continue
            token = _normalize_token(str(word.get("text", "")))
            if not token:
                continue
            if token == target or target in token or token in target:
                try:
                    bbox = {
                        "x0": float(word.get("x0")),
                        "y0": float(word.get("y0")),
                        "x1": float(word.get("x1")),
                        "y1": float(word.get("y1")),
                    }
                except (TypeError, ValueError):
                    bbox = None
                return int(page_number) if page_number is not None else None, bbox
    return None, None


def _append_evidence_atom(
    evidence: list[dict[str, Any]] | None,
    *,
    field: str,
    value: Any,
    source: str,
    text: str | None = None,
    start: int | None = None,
    end: int | None = None,
    page: int | None = None,
    bbox: dict[str, float] | None = None,
    confidence: float | None = None,
    snippet: str | None = None,
) -> None:
    if evidence is None or value in (None, ""):
        return

    span = None
    if start is not None and end is not None:
        span = EvidenceSpan(start=max(start, 0), end=max(end, max(start, 0)))

    bbox_model = None
    if isinstance(bbox, dict):
        try:
            bbox_model = EvidenceBBox(
                x0=float(bbox.get("x0")),
                y0=float(bbox.get("y0")),
                x1=float(bbox.get("x1")),
                y1=float(bbox.get("y1")),
            )
        except (TypeError, ValueError):
            bbox_model = None

    snippet_value = snippet
    if snippet_value is None and text is not None and span is not None:
        snippet_value = _snippet_from_span(text, span.start, span.end)

    atom = EvidenceAtom(
        field=field,
        value=value,
        source=source,
        page=page,
        span=span,
        bbox=bbox_model,
        confidence=confidence,
        snippet=snippet_value,
    )
    evidence.append(atom.model_dump(mode="json"))


def _append_regex_evidence(
    evidence: list[dict[str, Any]] | None,
    *,
    field: str,
    value: Any,
    source_text: str,
    match: re.Match[str],
    group_index: int = 1,
    source: str = "rule_regex",
    confidence: float = 0.96,
    pages: list[dict[str, Any]] | None = None,
) -> None:
    if evidence is None:
        return

    try:
        start = match.start(group_index)
        end = match.end(group_index)
    except IndexError:
        start = match.start(0)
        end = match.end(0)

    page, bbox = _find_page_bbox_for_value(pages, value)
    _append_evidence_atom(
        evidence,
        field=field,
        value=value,
        source=source,
        text=source_text,
        start=start,
        end=end,
        page=page,
        bbox=bbox,
        confidence=confidence,
    )


def _has_evidence_for_field(evidence: list[dict[str, Any]] | None, field: str) -> bool:
    if not isinstance(evidence, list):
        return False
    for atom in evidence:
        if isinstance(atom, dict) and atom.get("field") == field:
            return True
    return False


def _ensure_value_evidence(
    evidence: list[dict[str, Any]] | None,
    *,
    field: str,
    value: Any,
    text: str,
    source: str,
    pages: list[dict[str, Any]] | None = None,
) -> None:
    if evidence is None or value in (None, "") or _has_evidence_for_field(evidence, field):
        return
    target = str(value).strip()
    if not target:
        return

    match = re.search(re.escape(target), text, flags=re.IGNORECASE)
    if not match:
        return

    page, bbox = _find_page_bbox_for_value(pages, value)
    _append_evidence_atom(
        evidence,
        field=field,
        value=value,
        source=source,
        text=text,
        start=match.start(0),
        end=match.end(0),
        page=page,
        bbox=bbox,
        confidence=0.85,
    )


# ── Claude integration helpers ────────────────────────────────────────────────


def _value_in_text(value: Any, text: str) -> bool:
    """Return True if *value* appears literally in *text* (case-insensitive).

    For numeric values both the exact float string and the integer
    representation (for whole numbers) are checked, to handle documents
    that write ``1500`` where the parsed value is ``1500.0``.
    """
    if value is None:
        return False
    s = str(value).strip()
    if re.search(re.escape(s), text, flags=re.IGNORECASE):
        return True
    try:
        f = float(value)
        if f == int(f):
            return bool(re.search(re.escape(str(int(f))), text, flags=re.IGNORECASE))
    except (TypeError, ValueError):
        pass
    return False


def _parse_claude_json_only(raw: str) -> dict[str, Any]:
    """Parse raw Claude output as JSON only; no regex fallbacks."""
    try:
        loaded = json.loads(raw)
        if isinstance(loaded, dict):
            return loaded
    except Exception:
        pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end > start:
        try:
            loaded = json.loads(raw[start : end + 1])
            if isinstance(loaded, dict):
                return loaded
        except Exception:
            pass
    return {}


# Normalisation callables for each scalar field Claude may return.
_CLAUDE_SCALAR_NORMALISERS: dict[str, Callable[[Any], Any]] = {
    "importer_name": lambda v: str(v).strip() or None,
    "importer_eori": lambda v: str(v).strip().upper() or None,
    "invoice_number": lambda v: str(v).strip() or None,
    "invoice_date": lambda v: str(v).strip() or None,
    "origin_country": lambda v: str(v).strip().upper() or None,
    "incoterm": lambda v: str(v).strip().upper() or None,
    "entry_reference": lambda v: str(v).strip() or None,
    "method": lambda v: _normalize_method(str(v)),
    "net_mass_kg": lambda v: _parse_number(str(v)),
    "direct_embedded_kgco2e": lambda v: _parse_number(str(v)),
    "indirect_embedded_kgco2e": lambda v: _parse_number(str(v)),
}


def _merge_claude_scalar_fields(
    det: dict[str, Any],
    claude: dict[str, Any],
    raw_text: str,
    flags: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
    pages: list[dict[str, Any]] | None,
) -> None:
    """Apply deterministic-first merge rules for all scalar header fields.

    Rules (applied per field, in order):
    1. Valid deterministic value present → keep it; if Claude differs, log flag.
    2. Deterministic value absent → accept Claude's value only when:
       a. It passes the field validator (if one exists).
       b. The value appears literally in raw_text (evidence requirement).
    No valid deterministic value is ever overridden.
    """
    for field, normalise in _CLAUDE_SCALAR_NORMALISERS.items():
        raw_claude_val = claude.get(field)
        if raw_claude_val is None:
            continue
        claude_val = normalise(raw_claude_val)
        if claude_val is None:
            continue

        det_val = det.get(field)
        if det_val is not None:
            # Valid deterministic value present — never override.
            if claude_val != det_val:
                flags.append(
                    {
                        "field": field,
                        "issue": "claude_conflict_ignored",
                        "deterministic_value": det_val,
                        "claude_value": claude_val,
                    }
                )
            continue

        # Deterministic value absent — validate then check evidence.
        validator = _FIELD_VALIDATORS.get(field)
        if validator and not validator(claude_val):
            flags.append(
                {
                    "field": field,
                    "issue": "claude_value_failed_validation",
                    "value": claude_val,
                    "reason": _FIELD_VALIDATOR_REASONS.get(field, ""),
                    "source": "claude",
                }
            )
            continue

        if not _value_in_text(claude_val, raw_text):
            flags.append(
                {
                    "field": field,
                    "issue": "claude_value_not_evidenced_in_text",
                    "value": claude_val,
                    "source": "claude",
                }
            )
            continue

        det[field] = claude_val
        _ensure_value_evidence(
            evidence,
            field=field,
            value=claude_val,
            text=raw_text,
            source="claude_validated",
            pages=pages,
        )


# ── Line / emission extraction ────────────────────────────────────────────────


def _extract_lines_from_text(
    raw_text: str,
    evidence: list[dict[str, Any]] | None = None,
    field_prefix: str = "lines",
    pages: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    parsed_lines: list[dict[str, Any]] = []
    line_matches = re.finditer(r"^\s*Line\s+\d+\s*:\s*(.+)$", raw_text, flags=re.IGNORECASE | re.MULTILINE)

    for match in line_matches:
        payload = match.group(1).strip()
        parts = [part.strip() for part in payload.split("|")]
        if not parts:
            continue

        cn_code = None
        cn_match = re.search(r"\b(\d{6,8})\b", parts[0])
        if cn_match:
            cn_code = cn_match.group(1)

        description = parts[1] if len(parts) > 1 else None

        quantity = None
        quantity_unit = None
        quantity_source = parts[2] if len(parts) > 2 else payload
        quantity_match = re.search(r"([0-9][0-9,]*(?:\.[0-9]+)?)\s*([A-Za-z]+)", quantity_source)
        if quantity_match:
            quantity = _parse_number(quantity_match.group(1))
            quantity_unit = quantity_match.group(2).lower()

        net_mass_kg = None
        net_mass_match = re.search(
            r"net\s*mass(?:\s*kg)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
            payload,
            flags=re.IGNORECASE,
        )
        if net_mass_match:
            net_mass_kg = _parse_number(net_mass_match.group(1))

        direct = None
        direct_match = re.search(
            r"direct(?:\s+embedded)?\s*(?:emissions?)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
            payload,
            flags=re.IGNORECASE,
        )
        if direct_match:
            direct = _parse_number(direct_match.group(1))

        indirect = None
        indirect_match = re.search(
            r"indirect(?:\s+embedded)?\s*(?:emissions?)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
            payload,
            flags=re.IGNORECASE,
        )
        if indirect_match:
            indirect = _parse_number(indirect_match.group(1))

        method = None
        method_match = re.search(
            r"method\s*([A-Za-z_ -]+)",
            payload,
            flags=re.IGNORECASE,
        )
        if method_match:
            method = _normalize_method(method_match.group(1))

        if cn_code:
            line_index = len(parsed_lines)
            parsed_lines.append(
                {
                    "cn_code": cn_code,
                    "description": description,
                    "quantity": quantity,
                    "quantity_unit": quantity_unit,
                    "net_mass_kg": net_mass_kg if net_mass_kg is not None else quantity,
                    "direct_embedded_kgco2e": direct,
                    "indirect_embedded_kgco2e": indirect,
                    "method": method,
                }
            )
            _append_regex_evidence(
                evidence,
                field=f"{field_prefix}[{line_index}].cn_code",
                value=cn_code,
                source_text=raw_text,
                match=match,
                group_index=1,
                source="rule_regex_line",
                pages=pages,
            )
            if description:
                description_match = re.search(re.escape(description), payload, flags=re.IGNORECASE)
                if description_match:
                    _append_evidence_atom(
                        evidence,
                        field=f"{field_prefix}[{line_index}].description",
                        value=description,
                        source="rule_regex_line",
                        text=payload,
                        start=description_match.start(0),
                        end=description_match.end(0),
                        confidence=0.92,
                    )

    return parsed_lines


def _extract_global_emissions_from_text(raw_text: str) -> dict[str, Any] | None:
    method_match = re.search(
        r"(?:calculation\s*method|emissions\s*method|method)\s*[:\-]\s*([A-Za-z_ -]+)",
        raw_text,
        flags=re.IGNORECASE,
    )
    direct_match = re.search(
        r"direct(?:\s+embedded)?\s+emissions?(?:\s*\(?(?:kgco2e|kg\s*co2e)\)?)?\s*[:\-]\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
        raw_text,
        flags=re.IGNORECASE,
    )
    indirect_match = re.search(
        r"indirect(?:\s+embedded)?\s+emissions?(?:\s*\(?(?:kgco2e|kg\s*co2e)\)?)?\s*[:\-]\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
        raw_text,
        flags=re.IGNORECASE,
    )

    method = _normalize_method(method_match.group(1) if method_match else None)
    direct = _parse_number(direct_match.group(1) if direct_match else None)
    indirect = _parse_number(indirect_match.group(1) if indirect_match else None)

    if method is None and direct is None and indirect is None:
        return None
    if method is None:
        return None
    return {
        "method": method,
        "direct_embedded_kgco2e": direct,
        "indirect_embedded_kgco2e": indirect,
    }


def _parse_structured_response(
    raw: str,
    raw_text: str,
    layout: dict[str, Any] | None = None,
    evidence: list[dict[str, Any]] | None = None,
    pages: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    fields = [
        "importer_name",
        "importer_eori",
        "invoice_number",
        "entry_reference",
        "incoterm",
        "cn_code",
        "net_mass_kg",
        "origin_country",
        "invoice_date",
        "method",
        "direct_embedded_kgco2e",
        "indirect_embedded_kgco2e",
    ]
    parsed: dict[str, Any] = {}

    try:
        loaded = json.loads(raw)
        if isinstance(loaded, dict):
            parsed = loaded
    except Exception:
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                loaded = json.loads(raw[start : end + 1])
                if isinstance(loaded, dict):
                    parsed = loaded
            except Exception:
                parsed = {}

    structured = {key: parsed.get(key) for key in fields}
    header_text = _layout_text(layout, "header")
    full_text = raw_text or _layout_text(layout, "full_text")

    # Fallback extraction from raw text when model output is not valid JSON.
    if not structured.get("importer_name"):
        match = re.search(r"importer(?:\s+name)?\s*[:\-]\s*(.+)", full_text, flags=re.IGNORECASE)
        if match:
            structured["importer_name"] = match.group(1).strip()
            _append_regex_evidence(
                evidence,
                field="importer.name",
                value=structured["importer_name"],
                source_text=full_text,
                match=match,
                pages=pages,
            )
    if not structured.get("importer_eori"):
        match = re.search(r"\b[A-Z]{2}\d{6,}\b", full_text)
        if match:
            structured["importer_eori"] = match.group(0)
            _append_regex_evidence(
                evidence,
                field="importer.eori",
                value=structured["importer_eori"],
                source_text=full_text,
                match=match,
                group_index=0,
                pages=pages,
            )
    if not structured.get("cn_code"):
        match = re.search(r"\b\d{6,8}\b", full_text)
        if match:
            structured["cn_code"] = match.group(0)
            _append_regex_evidence(
                evidence,
                field="lines[0].cn_code",
                value=structured["cn_code"],
                source_text=full_text,
                match=match,
                group_index=0,
                pages=pages,
            )
    if structured.get("net_mass_kg") is None:
        match = re.search(
            r"(?:net\s*mass(?:\s*kg)?|quantity)\D*([0-9]+(?:\.[0-9]+)?)",
            full_text,
            flags=re.IGNORECASE,
        )
        if match:
            structured["net_mass_kg"] = float(match.group(1))
            _append_regex_evidence(
                evidence,
                field="lines[0].net_mass_kg",
                value=structured["net_mass_kg"],
                source_text=full_text,
                match=match,
                pages=pages,
            )
    if not structured.get("origin_country"):
        match = re.search(r"origin\s*country\s*[:\-]\s*([A-Z]{2})", full_text, flags=re.IGNORECASE)
        if match:
            structured["origin_country"] = match.group(1)
            _append_regex_evidence(
                evidence,
                field="invoice.origin_country",
                value=structured["origin_country"],
                source_text=full_text,
                match=match,
                pages=pages,
            )
    if not structured.get("invoice_number"):
        header_match = re.search(
            r"invoice\s*(?:number|no\.?)\s*[:\-]\s*([A-Za-z0-9\-_/]+)",
            header_text,
            flags=re.IGNORECASE,
        )
        full_match = None
        match = header_match
        source_text = header_text
        if not match:
            full_match = re.search(
                r"invoice\s*(?:number|no\.?)\s*[:\-]\s*([A-Za-z0-9\-_/]+)",
                full_text,
                flags=re.IGNORECASE,
            )
            match = full_match
            source_text = full_text
        if match:
            structured["invoice_number"] = match.group(1)
            _append_regex_evidence(
                evidence,
                field="invoice.invoice_number",
                value=structured["invoice_number"],
                source_text=source_text,
                match=match,
                pages=pages,
            )
    if not structured.get("entry_reference"):
        match = re.search(
            r"(?:entry\s*reference|entry\s*ref(?:erence)?)\s*[:\-]\s*([A-Za-z0-9\-_/]+)",
            full_text,
            flags=re.IGNORECASE,
        )
        if match:
            structured["entry_reference"] = match.group(1)
            _append_regex_evidence(
                evidence,
                field="invoice.entry_reference",
                value=structured["entry_reference"],
                source_text=full_text,
                match=match,
                pages=pages,
            )
    if not structured.get("incoterm"):
        match = re.search(r"incoterm\s*[:\-]\s*([A-Za-z]{3})", full_text, flags=re.IGNORECASE)
        if match:
            structured["incoterm"] = match.group(1).upper()
            _append_regex_evidence(
                evidence,
                field="invoice.incoterm",
                value=structured["incoterm"],
                source_text=full_text,
                match=match,
                pages=pages,
            )
    if not structured.get("method"):
        match = re.search(
            r"(?:calculation\s*method|emissions\s*method|method)\s*[:\-]\s*([A-Za-z_ -]+)",
            full_text,
            flags=re.IGNORECASE,
        )
        if match:
            structured["method"] = _normalize_method(match.group(1))
    else:
        structured["method"] = _normalize_method(str(structured.get("method")))
    if structured.get("direct_embedded_kgco2e") is None:
        match = re.search(
            r"direct(?:\s+embedded)?\s+emissions?(?:\s*\(?(?:kgco2e|kg\s*co2e)\)?)?\s*[:\-]\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
            full_text,
            flags=re.IGNORECASE,
        )
        if match:
            structured["direct_embedded_kgco2e"] = _parse_number(match.group(1))
            _append_regex_evidence(
                evidence,
                field="emissions.direct_embedded_kgco2e",
                value=structured["direct_embedded_kgco2e"],
                source_text=full_text,
                match=match,
                pages=pages,
            )
    else:
        structured["direct_embedded_kgco2e"] = _parse_number(str(structured.get("direct_embedded_kgco2e")))
    if structured.get("indirect_embedded_kgco2e") is None:
        match = re.search(
            r"indirect(?:\s+embedded)?\s+emissions?(?:\s*\(?(?:kgco2e|kg\s*co2e)\)?)?\s*[:\-]\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
            full_text,
            flags=re.IGNORECASE,
        )
        if match:
            structured["indirect_embedded_kgco2e"] = _parse_number(match.group(1))
            _append_regex_evidence(
                evidence,
                field="emissions.indirect_embedded_kgco2e",
                value=structured["indirect_embedded_kgco2e"],
                source_text=full_text,
                match=match,
                pages=pages,
            )
    else:
        structured["indirect_embedded_kgco2e"] = _parse_number(str(structured.get("indirect_embedded_kgco2e")))
    if not structured.get("invoice_date"):
        header_match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", header_text)
        full_match = None
        match = header_match
        source_text = header_text
        if not match:
            full_match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", full_text)
            match = full_match
            source_text = full_text
        if match:
            structured["invoice_date"] = match.group(0)
            _append_regex_evidence(
                evidence,
                field="invoice.invoice_date",
                value=structured["invoice_date"],
                source_text=source_text,
                match=match,
                group_index=0,
                pages=pages,
            )

    return structured


def _build_extraction_payload(
    raw_text: str,
    structured: dict[str, Any],
    layout: dict[str, Any] | None = None,
    evidence: list[dict[str, Any]] | None = None,
    pages: list[dict[str, Any]] | None = None,
    flags: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    body_text = _layout_text(layout, "body")
    extracted_lines = (
        _extract_lines_from_text(
            body_text,
            evidence=evidence,
            field_prefix="lines",
            pages=pages,
        )
        if body_text
        else []
    )
    if not extracted_lines:
        extracted_lines = _extract_lines_from_text(
            raw_text,
            evidence=evidence,
            field_prefix="lines",
            pages=pages,
        )
    if not extracted_lines and structured.get("cn_code"):
        extracted_lines = [
            {
                "cn_code": structured.get("cn_code"),
                "description": None,
                "quantity": structured.get("net_mass_kg"),
                "quantity_unit": "kg" if structured.get("net_mass_kg") is not None else None,
                "net_mass_kg": structured.get("net_mass_kg"),
                "direct_embedded_kgco2e": None,
                "indirect_embedded_kgco2e": None,
                "method": None,
            }
        ]

    has_line_emissions = any(
        line.get("method") is not None
        or line.get("direct_embedded_kgco2e") is not None
        or line.get("indirect_embedded_kgco2e") is not None
        for line in extracted_lines
    )

    emissions = None
    if not has_line_emissions:
        emissions = _extract_global_emissions_from_text(raw_text)
        if emissions is None:
            emissions_method = _normalize_method(structured.get("method"))
            direct = (
                _parse_number(str(structured.get("direct_embedded_kgco2e")))
                if structured.get("direct_embedded_kgco2e") is not None
                else None
            )
            indirect = (
                _parse_number(str(structured.get("indirect_embedded_kgco2e")))
                if structured.get("indirect_embedded_kgco2e") is not None
                else None
            )
            if emissions_method is not None and (direct is not None or indirect is not None):
                emissions = {
                    "method": emissions_method,
                    "direct_embedded_kgco2e": direct,
                    "indirect_embedded_kgco2e": indirect,
                }

    _ensure_value_evidence(
        evidence,
        field="invoice.invoice_number",
        value=structured.get("invoice_number"),
        text=raw_text,
        source="rule_value",
        pages=pages,
    )
    _ensure_value_evidence(
        evidence,
        field="invoice.invoice_date",
        value=structured.get("invoice_date"),
        text=raw_text,
        source="rule_value",
        pages=pages,
    )
    _ensure_value_evidence(
        evidence,
        field="importer.eori",
        value=structured.get("importer_eori"),
        text=raw_text,
        source="rule_value",
        pages=pages,
    )

    return {
        "status": "parsed",
        "raw_text_preview": (raw_text or "")[:500],
        "flags": flags or [],
        "importer": {
            "name": structured.get("importer_name"),
            "eori": structured.get("importer_eori"),
        },
        "invoice": {
            "invoice_number": structured.get("invoice_number"),
            "invoice_date": structured.get("invoice_date"),
            "origin_country": structured.get("origin_country"),
            "incoterm": structured.get("incoterm"),
            "entry_reference": structured.get("entry_reference"),
        },
        "lines": extracted_lines,
        "emissions": emissions,
        "structured": structured,
        "evidence": evidence or [],
    }


def _read_raw_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        try:
            return path.read_text(encoding="latin-1")
        except Exception:
            return ""


class LlamaIndexCBAMExtractor:
    def extract(
        self,
        file_path: str,
        layout: dict[str, Any] | None = None,
        pages: list[dict[str, Any]] | None = None,
    ) -> dict:
        path = Path(file_path)
        if not path.exists():
            return {"status": "error", "message": f"File not found: {file_path}"}

        raw_text_for_fallback = _read_raw_text(path)
        evidence: list[dict[str, Any]] = []
        try:
            from llama_index.core import SimpleDirectoryReader, VectorStoreIndex
            from llama_index.core.embeddings import MockEmbedding
            from llama_index.core.llms.mock import MockLLM
            from llama_index.core.schema import Document
        except Exception:
            structured = _parse_structured_response(
                "{}",
                raw_text_for_fallback,
                layout=layout,
                evidence=evidence,
                pages=pages,
            )
            payload = _build_extraction_payload(
                raw_text_for_fallback,
                structured,
                layout=layout,
                evidence=evidence,
                pages=pages,
            )
            payload["status"] = "parsed"
            payload["fallback"] = "regex_only"
            return payload

        try:
            documents = SimpleDirectoryReader(input_files=[str(path)]).load_data()

            raw_text = "\n\n".join(
                (getattr(doc, "text", "") or "").strip() for doc in documents
            ).strip()

            if not raw_text:
                raw_text = _read_raw_text(path)

            if not documents:
                documents = [Document(text=raw_text)]

            index = VectorStoreIndex.from_documents(
                documents,
                embed_model=MockEmbedding(embed_dim=32),
            )
            query_engine = index.as_query_engine(llm=MockLLM())
            response = query_engine.query(
                "Extract and return ONLY a JSON object with keys: "
                "importer_name, importer_eori, invoice_number, entry_reference, incoterm, "
                "cn_code, net_mass_kg, origin_country, invoice_date, method, "
                "direct_embedded_kgco2e, indirect_embedded_kgco2e. "
                "Use method values actual/default/estimated and null for missing values."
            )
            structured = _parse_structured_response(
                str(response),
                raw_text,
                layout=layout,
                evidence=evidence,
                pages=pages,
            )
            return _build_extraction_payload(
                raw_text,
                structured,
                layout=layout,
                evidence=evidence,
                pages=pages,
            )
        except Exception as e:
            return {"status": "error", "message": str(e)}


class ClaudeCBAMExtractor:
    """Production CBAM invoice extractor using Anthropic Claude.

    Implements a deterministic-first hybrid architecture:

    1. Regex/structured parsing always runs first and is the primary source of
       truth.  Every extracted value is validated (incoterm whitelist, ISO-2,
       EORI regex, 6-8 digit CN code, positive numeric mass, YYYY-MM-DD date).
    2. Claude is called once (when ``ANTHROPIC_API_KEY`` is set) to fill
       fields that regex could not find.  A Claude value is accepted only when:
       a. It passes the same field validator.
       b. Its string representation appears literally in ``raw_text``
          (evidence requirement).
    3. No valid deterministic value is ever overridden.  All conflicts and
       rejected Claude suggestions are recorded in the top-level ``flags``
       array of the returned payload.
    4. Line items from Claude are merged only when deterministic extraction
       found zero lines, and only after each line passes CN-code and
       positive-mass validation with evidence in ``raw_text``.
    5. Output is fully deterministic across runs (no stochastic post-
       processing; Claude's role is purely gap-filling after strict
       validation).

    Falls back to regex-only extraction when ``ANTHROPIC_API_KEY`` is absent
    or the API call fails.

    Environment variables
    ---------------------
    ANTHROPIC_API_KEY       Required for live extraction.
    CBAM_EXTRACTOR_MODEL    Claude model ID to use.
                            Defaults to ``claude-haiku-4-5-20251001``.
    """

    _PROMPT = (
        "You are a CBAM (Carbon Border Adjustment Mechanism) compliance specialist.\n"
        "Extract structured data from the invoice/document text below.\n\n"
        "Return ONLY a valid JSON object with this exact structure "
        "(use null for any field not found):\n"
        "{\n"
        '  "importer_name": string | null,\n'
        '  "importer_eori": "EU EORI number: 2-letter country code + digits" | null,\n'
        '  "invoice_number": string | null,\n'
        '  "invoice_date": "YYYY-MM-DD" | null,\n'
        '  "origin_country": "ISO-3166-1 alpha-2 code of goods origin" | null,\n'
        '  "incoterm": "3-letter Incoterm e.g. CIF FOB DAP" | null,\n'
        '  "entry_reference": "customs entry / MRN reference" | null,\n'
        '  "lines": [\n'
        '    {\n'
        '      "cn_code": "6-8 digit EU Combined Nomenclature code" | null,\n'
        '      "description": string | null,\n'
        '      "net_mass_kg": number | null,\n'
        '      "direct_embedded_kgco2e": number | null,\n'
        '      "indirect_embedded_kgco2e": number | null,\n'
        '      "method": "actual" | "default" | "estimated" | null\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- CN codes must be 6-8 digit numeric EU Combined Nomenclature codes.\n"
        "- method must be exactly one of: actual, default, estimated (or null).\n"
        "- Do not include any text, markdown or explanation outside the JSON.\n\n"
        "Document text:\n{document_text}"
    )

    def __init__(self, model: str | None = None) -> None:
        self.model = model or os.getenv(
            "CBAM_EXTRACTOR_MODEL", "claude-haiku-4-5-20251001"
        )

    def _call_claude(self, document_text: str) -> str:
        import anthropic  # lazy import; fails gracefully if not installed

        client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from env
        message = client.messages.create(
            model=self.model,
            max_tokens=2048,
            messages=[
                {
                    "role": "user",
                    "content": self._PROMPT.replace(
                        "{document_text}", document_text[:8000]
                    ),
                }
            ],
        )
        return message.content[0].text

    def _merge_claude_lines(
        self,
        payload: dict[str, Any],
        claude_json: dict[str, Any],
        evidence: list[dict[str, Any]],
        raw_text: str,
        flags: list[dict[str, Any]],
        pages: list[dict[str, Any]] | None,
    ) -> None:
        """Merge Claude line items only when deterministic extraction found none.

        Each candidate line must pass CN-code validation, positive-mass
        validation, and have both values evidenced in ``raw_text``.  Rejected
        lines are recorded in ``flags``; the payload is only updated when at
        least one line passes all checks.
        """
        if payload.get("lines"):
            return  # deterministic lines take precedence

        claude_lines = claude_json.get("lines")
        if not isinstance(claude_lines, list):
            return

        lines: list[dict[str, Any]] = []
        for i, cl in enumerate(claude_lines):
            if not isinstance(cl, dict):
                continue

            cn_code = cl.get("cn_code")
            if not cn_code:
                flags.append(
                    {"issue": "claude_line_missing_cn_code", "line_index": i, "source": "claude"}
                )
                continue
            cn_code = str(cn_code).strip()
            if not _valid_cn_code(cn_code):
                flags.append(
                    {
                        "issue": "claude_line_invalid_cn_code",
                        "line_index": i,
                        "value": cn_code,
                        "source": "claude",
                    }
                )
                continue
            if not _value_in_text(cn_code, raw_text):
                flags.append(
                    {
                        "issue": "claude_line_cn_code_not_evidenced",
                        "line_index": i,
                        "value": cn_code,
                        "source": "claude",
                    }
                )
                continue

            mass = (
                _parse_number(str(cl["net_mass_kg"]))
                if cl.get("net_mass_kg") is not None
                else None
            )
            if not _valid_mass(mass):
                flags.append(
                    {
                        "issue": "claude_line_invalid_mass",
                        "line_index": i,
                        "value": mass,
                        "source": "claude",
                    }
                )
                continue
            if not _value_in_text(mass, raw_text):
                flags.append(
                    {
                        "issue": "claude_line_mass_not_evidenced",
                        "line_index": i,
                        "value": mass,
                        "source": "claude",
                    }
                )
                continue

            line: dict[str, Any] = {
                "cn_code": cn_code,
                "description": cl.get("description"),
                "quantity": mass,
                "quantity_unit": "kg",
                "net_mass_kg": mass,
                "direct_embedded_kgco2e": (
                    _parse_number(str(cl["direct_embedded_kgco2e"]))
                    if cl.get("direct_embedded_kgco2e") is not None
                    else None
                ),
                "indirect_embedded_kgco2e": (
                    _parse_number(str(cl["indirect_embedded_kgco2e"]))
                    if cl.get("indirect_embedded_kgco2e") is not None
                    else None
                ),
                "method": _normalize_method(cl.get("method")),
            }
            lines.append(line)
            _ensure_value_evidence(
                evidence,
                field=f"lines[{i}].cn_code",
                value=cn_code,
                text=raw_text,
                source="claude_validated",
                pages=pages,
            )

        if lines:
            payload["lines"] = lines

    def extract(
        self,
        file_path: str,
        layout: dict[str, Any] | None = None,
        pages: list[dict[str, Any]] | None = None,
    ) -> dict:
        path = Path(file_path)
        if not path.exists():
            return {"status": "error", "message": f"File not found: {file_path}"}

        evidence: list[dict[str, Any]] = []
        flags: list[dict[str, Any]] = []

        # ── 1. Load document text (LlamaIndex handles PDF / DOCX / TXT) ──────
        raw_text = ""
        try:
            from llama_index.core import SimpleDirectoryReader

            documents = SimpleDirectoryReader(input_files=[str(path)]).load_data()
            raw_text = "\n\n".join(
                (getattr(doc, "text", "") or "").strip() for doc in documents
            ).strip()
        except Exception:
            pass
        if not raw_text:
            raw_text = _read_raw_text(path)

        # ── 2. Deterministic (regex-first) extraction — always the primary source
        det_structured = _parse_structured_response(
            "{}",
            raw_text,
            layout=layout,
            evidence=evidence,
            pages=pages,
        )

        # ── 3. Validate all deterministic fields; clear invalids, record flags
        _validate_deterministic_fields(det_structured, flags)

        # ── 4. Claude gap-filling (one API call, scalar fields then lines) ────
        api_key = os.getenv("ANTHROPIC_API_KEY")
        extractor_tag = "regex"
        claude_json: dict[str, Any] = {}

        if api_key and raw_text:
            try:
                response_text = self._call_claude(raw_text)
                claude_json = _parse_claude_json_only(response_text)
                _merge_claude_scalar_fields(
                    det_structured, claude_json, raw_text, flags, evidence, pages
                )
                extractor_tag = f"claude:{self.model}"
            except Exception:
                flags.append({"issue": "claude_api_call_failed", "source": "claude"})

        # ── 5. Build payload from the merged deterministic result ─────────────
        payload = _build_extraction_payload(
            raw_text,
            det_structured,
            layout=layout,
            evidence=evidence,
            pages=pages,
            flags=flags,
        )

        # ── 6. Merge Claude lines only when deterministic found none ──────────
        if not payload.get("lines") and claude_json:
            self._merge_claude_lines(payload, claude_json, evidence, raw_text, flags, pages)

        payload["extractor"] = extractor_tag
        if extractor_tag == "regex":
            payload["fallback"] = "regex_only"
        return payload


_EXTRACTOR: CBAMExtractor = ClaudeCBAMExtractor()


def extract(
    file_path: str,
    layout: dict[str, Any] | None = None,
    pages: list[dict[str, Any]] | None = None,
) -> dict:
    try:
        return _EXTRACTOR.extract(file_path, layout=layout, pages=pages)
    except TypeError:
        try:
            return _EXTRACTOR.extract(file_path, layout=layout)
        except TypeError:
            return _EXTRACTOR.extract(file_path)
