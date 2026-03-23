from __future__ import annotations

from copy import deepcopy
import re
from typing import Any

from ledger_app.schemas.evidence import EvidenceAtom
from ledger_app.schemas.evidence import EvidenceSpan


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
        joined = " ".join(
            str(block.get("text", "")).strip()
            for block in blocks
            if isinstance(block, dict) and str(block.get("type", "")).strip().lower() == zone
        ).strip()
        if joined:
            return joined
    return ""


def _full_text(parsed: dict[str, Any]) -> str:
    for key in ("full_text", "raw_text", "raw_text_preview"):
        value = parsed.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def _extract_invoice_number(text: str) -> str | None:
    if not text:
        return None
    match = re.search(
        r"invoice\s*(?:number|no\.?)\s*[:#\-]?\s*([A-Za-z0-9][A-Za-z0-9\-_\/]+)",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    return match.group(1).strip()


def _extract_invoice_date(text: str) -> str | None:
    if not text:
        return None
    match = re.search(
        r"(?:invoice\s*date|date)\s*[:#\-]?\s*(\d{4}-\d{2}-\d{2})",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    return match.group(1).strip()


def _extract_origin_country(text: str) -> str | None:
    if not text:
        return None
    match = re.search(r"origin(?:\s+country)?\s*[:#\-]?\s*([A-Z]{2})\b", text, flags=re.IGNORECASE)
    if not match:
        return None
    return match.group(1).upper()


def _extract_incoterm(text: str) -> str | None:
    if not text:
        return None
    match = re.search(r"incoterm\s*[:#\-]?\s*([A-Za-z]{3})\b", text, flags=re.IGNORECASE)
    if not match:
        return None
    return match.group(1).upper()


def _parse_number(text: str | None) -> float | None:
    if text is None:
        return None
    normalized = text.replace(",", "").strip()
    if not normalized:
        return None
    try:
        return float(normalized)
    except ValueError:
        return None


def _extract_lines_from_text(text: str) -> list[dict[str, Any]]:
    if not text:
        return []

    parsed_lines: list[dict[str, Any]] = []
    matches = re.finditer(r"^\s*Line\s+\d+\s*:\s*(.+)$", text, flags=re.IGNORECASE | re.MULTILINE)
    for match in matches:
        payload = match.group(1).strip()
        parts = [part.strip() for part in payload.split("|")]
        first_segment = parts[0] if parts else payload

        cn_match = re.search(r"\b(\d{6})\b", first_segment)
        cn_code = cn_match.group(1) if cn_match else None

        description = parts[1] if len(parts) > 1 else None
        quantity = None
        quantity_unit = None
        quantity_source = parts[2] if len(parts) > 2 else payload
        quantity_match = re.search(r"([0-9][0-9,]*(?:\.[0-9]+)?)\s*([A-Za-z]+)\b", quantity_source)
        if quantity_match:
            quantity = _parse_number(quantity_match.group(1))
            quantity_unit = quantity_match.group(2).lower()

        net_mass_match = re.search(
            r"net\s*mass(?:\s*kg)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
            payload,
            flags=re.IGNORECASE,
        )
        net_mass_kg = _parse_number(net_mass_match.group(1) if net_mass_match else None)

        if cn_code:
            parsed_lines.append(
                {
                    "cn_code": cn_code,
                    "description": description,
                    "quantity": quantity,
                    "quantity_unit": quantity_unit,
                    "net_mass_kg": net_mass_kg if net_mass_kg is not None else quantity,
                }
            )

    return parsed_lines


def _append_repair_evidence(
    evidence: list[dict[str, Any]],
    *,
    field: str,
    value: Any,
    text: str,
    source: str,
) -> None:
    if value in (None, "") or not text:
        return
    match = re.search(re.escape(str(value)), text, flags=re.IGNORECASE)
    if not match:
        return
    evidence.append(
        EvidenceAtom(
            field=field,
            value=value,
            source=source,
            span=EvidenceSpan(start=match.start(0), end=match.end(0)),
            snippet=text[max(0, match.start(0) - 40) : min(len(text), match.end(0) + 40)].strip(),
            confidence=0.82,
        ).model_dump(mode="json")
    )


def repair_parsed_invoice(parsed: dict) -> tuple[dict, list[str]]:
    """
    Repair missing parsed invoice fields without hallucinating values.

    Priority:
    1) layout-aware zones (header for invoice fields, body for lines)
    2) full-text regex fallback
    3) if unresolved, keep null and emit repair_failed warning tags
    """
    repaired = deepcopy(parsed if isinstance(parsed, dict) else {})
    warnings: list[str] = []
    evidence = repaired.get("evidence")
    if not isinstance(evidence, list):
        evidence = []
        repaired["evidence"] = evidence

    invoice = repaired.get("invoice")
    if not isinstance(invoice, dict):
        invoice = {}
        repaired["invoice"] = invoice

    layout = repaired.get("layout")
    header_text = _layout_text(layout if isinstance(layout, dict) else None, "header")
    body_text = _layout_text(layout if isinstance(layout, dict) else None, "body")
    full_text = _full_text(repaired)

    if not invoice.get("invoice_number"):
        value = _extract_invoice_number(header_text) or _extract_invoice_number(full_text)
        if value:
            invoice["invoice_number"] = value
            _append_repair_evidence(
                evidence,
                field="invoice.invoice_number",
                value=value,
                text=header_text or full_text,
                source="repair_regex",
            )
        else:
            warnings.append("repair_failed:invoice_number")

    if not invoice.get("invoice_date"):
        value = _extract_invoice_date(header_text) or _extract_invoice_date(full_text)
        if value:
            invoice["invoice_date"] = value
            _append_repair_evidence(
                evidence,
                field="invoice.invoice_date",
                value=value,
                text=header_text or full_text,
                source="repair_regex",
            )
        else:
            warnings.append("repair_failed:invoice_date")

    if not invoice.get("origin_country"):
        value = _extract_origin_country(full_text)
        if value:
            invoice["origin_country"] = value
            _append_repair_evidence(
                evidence,
                field="invoice.origin_country",
                value=value,
                text=full_text,
                source="repair_regex",
            )
        else:
            warnings.append("repair_failed:origin_country")

    if not invoice.get("incoterm"):
        value = _extract_incoterm(full_text)
        if value:
            invoice["incoterm"] = value
            _append_repair_evidence(
                evidence,
                field="invoice.incoterm",
                value=value,
                text=full_text,
                source="repair_regex",
            )
        else:
            warnings.append("repair_failed:incoterm")

    fallback_lines = _extract_lines_from_text(body_text) if body_text else []
    if not fallback_lines:
        fallback_lines = _extract_lines_from_text(full_text)

    lines = repaired.get("lines")
    if not isinstance(lines, list):
        lines = []
        repaired["lines"] = lines

    if not lines and fallback_lines:
        repaired["lines"] = deepcopy(fallback_lines)
        lines = repaired["lines"]

    for idx, line in enumerate(lines):
        if not isinstance(line, dict):
            continue
        fallback_line = fallback_lines[idx] if idx < len(fallback_lines) else {}
        if not isinstance(fallback_line, dict):
            fallback_line = {}

        if not line.get("cn_code") and fallback_line.get("cn_code"):
            line["cn_code"] = fallback_line.get("cn_code")
            _append_repair_evidence(
                evidence,
                field=f"lines[{idx}].cn_code",
                value=line["cn_code"],
                text=body_text or full_text,
                source="repair_regex",
            )
        if line.get("quantity") is None and fallback_line.get("quantity") is not None:
            line["quantity"] = fallback_line.get("quantity")
        if line.get("net_mass_kg") is None:
            if fallback_line.get("net_mass_kg") is not None:
                line["net_mass_kg"] = fallback_line.get("net_mass_kg")
            elif line.get("quantity") is not None:
                line["net_mass_kg"] = line.get("quantity")

        if not line.get("cn_code"):
            warnings.append(f"repair_failed:lines[{idx}].cn_code")
        if line.get("quantity") is None:
            warnings.append(f"repair_failed:lines[{idx}].quantity")
        if line.get("net_mass_kg") is None:
            warnings.append(f"repair_failed:lines[{idx}].net_mass_kg")

    return repaired, warnings
