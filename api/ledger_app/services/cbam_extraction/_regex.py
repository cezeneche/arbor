"""Regex-based extraction of CBAM invoice fields.

This module implements the deterministic (non-AI) extraction layer. It runs
first on every document and is the primary source of truth. Claude is called
afterwards only to fill gaps that regex could not find.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from ._validators import _normalize_method, _parse_number
from ._evidence import (
    _append_evidence_atom,
    _append_regex_evidence,
    _ensure_value_evidence,
    _layout_text,
)


def _extract_lines_from_text(
    raw_text: str,
    evidence: list[dict[str, Any]] | None = None,
    field_prefix: str = "lines",
    pages: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    parsed_lines: list[dict[str, Any]] = []
    line_matches = re.finditer(
        r"^\s*Line\s+\d+\s*:\s*(.+)$", raw_text, flags=re.IGNORECASE | re.MULTILINE
    )

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
            r"net\s*mass(?:\s*kg)?\s*([0-9][0-9.,\s ]*[0-9]|[0-9])",
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
                description_match = re.search(
                    re.escape(description), payload, flags=re.IGNORECASE
                )
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
        "importer_name", "importer_eori", "invoice_number", "entry_reference",
        "incoterm", "cn_code", "net_mass_kg", "origin_country", "invoice_date",
        "method", "direct_embedded_kgco2e", "indirect_embedded_kgco2e",
        "operator_name", "installation_name", "installation_id",
        "production_route", "import_date",
        "carbon_price_paid_eur", "carbon_price_paid_currency",
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
                loaded = json.loads(raw[start: end + 1])
                if isinstance(loaded, dict):
                    parsed = loaded
            except Exception:
                parsed = {}

    structured = {key: parsed.get(key) for key in fields}
    header_text = _layout_text(layout, "header")
    full_text = raw_text or _layout_text(layout, "full_text")

    if not structured.get("importer_name"):
        match = re.search(r"importer(?:\s+name)?\s*[:\-]\s*(.+)", full_text, flags=re.IGNORECASE)
        if match:
            structured["importer_name"] = match.group(1).strip()
            _append_regex_evidence(evidence, field="importer.name",
                                   value=structured["importer_name"],
                                   source_text=full_text, match=match, pages=pages)
    if not structured.get("importer_eori"):
        match = re.search(r"\b[A-Z]{2}\d{6,}\b", full_text)
        if match:
            structured["importer_eori"] = match.group(0)
            _append_regex_evidence(evidence, field="importer.eori",
                                   value=structured["importer_eori"],
                                   source_text=full_text, match=match, group_index=0, pages=pages)
    if not structured.get("cn_code"):
        match = re.search(r"\b\d{6,8}\b", full_text)
        if match:
            structured["cn_code"] = match.group(0)
            _append_regex_evidence(evidence, field="lines[0].cn_code",
                                   value=structured["cn_code"],
                                   source_text=full_text, match=match, group_index=0, pages=pages)
    if structured.get("net_mass_kg") is None:
        # The character class must admit separators. Stopping at the first comma
        # read "24,500.00 kg" as 24 — a thousand-fold under-declaration that no
        # downstream check catches, because 24 kg is a plausible quantity.
        match = re.search(
            r"(?:net\s*mass(?:\s*kg)?|quantity)\D*([0-9][0-9.,\s ]*[0-9]|[0-9])",
            full_text, flags=re.IGNORECASE,
        )
        if match:
            structured["net_mass_kg"] = _parse_number(match.group(1))
            _append_regex_evidence(evidence, field="lines[0].net_mass_kg",
                                   value=structured["net_mass_kg"],
                                   source_text=full_text, match=match, pages=pages)
    if not structured.get("origin_country"):
        # "country of origin" is the phrasing on commercial invoices and on
        # customs Box 34; matching only "origin country" missed both. The code
        # must stand alone — a word boundary after it stops "Turkey" being read
        # as the ISO code "TU".
        match = re.search(
            r"(?:country\s+of\s+origin|origin\s*country)\s*[:\-]?\s*([A-Z]{2})\b(?![A-Za-z])",
            full_text,
            flags=re.IGNORECASE,
        )
        if match:
            structured["origin_country"] = match.group(1)
            _append_regex_evidence(evidence, field="invoice.origin_country",
                                   value=structured["origin_country"],
                                   source_text=full_text, match=match, pages=pages)
    if not structured.get("invoice_number"):
        header_match = re.search(
            r"invoice\s*(?:number|no\.?)\s*[:\-]\s*([A-Za-z0-9\-_/]+)",
            header_text, flags=re.IGNORECASE,
        )
        match = header_match
        source_text = header_text
        if not match:
            match = re.search(
                r"invoice\s*(?:number|no\.?)\s*[:\-]\s*([A-Za-z0-9\-_/]+)",
                full_text, flags=re.IGNORECASE,
            )
            source_text = full_text
        if match:
            structured["invoice_number"] = match.group(1)
            _append_regex_evidence(evidence, field="invoice.invoice_number",
                                   value=structured["invoice_number"],
                                   source_text=source_text, match=match, pages=pages)
    if not structured.get("entry_reference"):
        match = re.search(
            r"(?:entry\s*reference|entry\s*ref(?:erence)?)\s*[:\-]\s*([A-Za-z0-9\-_/]+)",
            full_text, flags=re.IGNORECASE,
        )
        if match:
            structured["entry_reference"] = match.group(1)
            _append_regex_evidence(evidence, field="invoice.entry_reference",
                                   value=structured["entry_reference"],
                                   source_text=full_text, match=match, pages=pages)
    if not structured.get("incoterm"):
        match = re.search(r"incoterm\s*[:\-]\s*([A-Za-z]{3})", full_text, flags=re.IGNORECASE)
        if match:
            structured["incoterm"] = match.group(1).upper()
            _append_regex_evidence(evidence, field="invoice.incoterm",
                                   value=structured["incoterm"],
                                   source_text=full_text, match=match, pages=pages)
    if not structured.get("method"):
        match = re.search(
            r"(?:calculation\s*method|emissions\s*method|method)\s*[:\-]\s*([A-Za-z_ -]+)",
            full_text, flags=re.IGNORECASE,
        )
        if match:
            structured["method"] = _normalize_method(match.group(1))
    else:
        structured["method"] = _normalize_method(str(structured.get("method")))
    if structured.get("direct_embedded_kgco2e") is None:
        match = re.search(
            r"direct(?:\s+embedded)?\s+emissions?(?:\s*\(?(?:kgco2e|kg\s*co2e)\)?)?\s*[:\-]\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
            full_text, flags=re.IGNORECASE,
        )
        if match:
            structured["direct_embedded_kgco2e"] = _parse_number(match.group(1))
            _append_regex_evidence(evidence, field="emissions.direct_embedded_kgco2e",
                                   value=structured["direct_embedded_kgco2e"],
                                   source_text=full_text, match=match, pages=pages)
    else:
        structured["direct_embedded_kgco2e"] = _parse_number(
            str(structured.get("direct_embedded_kgco2e"))
        )
    if structured.get("indirect_embedded_kgco2e") is None:
        match = re.search(
            r"indirect(?:\s+embedded)?\s+emissions?(?:\s*\(?(?:kgco2e|kg\s*co2e)\)?)?\s*[:\-]\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
            full_text, flags=re.IGNORECASE,
        )
        if match:
            structured["indirect_embedded_kgco2e"] = _parse_number(match.group(1))
            _append_regex_evidence(evidence, field="emissions.indirect_embedded_kgco2e",
                                   value=structured["indirect_embedded_kgco2e"],
                                   source_text=full_text, match=match, pages=pages)
    else:
        structured["indirect_embedded_kgco2e"] = _parse_number(
            str(structured.get("indirect_embedded_kgco2e"))
        )
    if not structured.get("invoice_date"):
        header_match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", header_text)
        match = header_match
        source_text = header_text
        if not match:
            match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", full_text)
            source_text = full_text
        if match:
            structured["invoice_date"] = match.group(0)
            _append_regex_evidence(evidence, field="invoice.invoice_date",
                                   value=structured["invoice_date"],
                                   source_text=source_text, match=match, group_index=0,
                                   pages=pages)

    # ── CBAM-specific field extraction ────────────────────────────────────────
    if not structured.get("operator_name"):
        match = re.search(
            r"(?:operator|supplier|exporter|seller)\s*(?:name)?\s*[:\-]\s*(.+)",
            full_text, flags=re.IGNORECASE,
        )
        if match:
            structured["operator_name"] = match.group(1).strip()
            _append_regex_evidence(evidence, field="cbam.operator_name",
                                   value=structured["operator_name"],
                                   source_text=full_text, match=match, pages=pages)
    if not structured.get("installation_name"):
        match = re.search(
            r"installation\s*name\s*[:\-]\s*(.+)", full_text, flags=re.IGNORECASE
        )
        if match:
            structured["installation_name"] = match.group(1).strip()
            _append_regex_evidence(evidence, field="cbam.installation_name",
                                   value=structured["installation_name"],
                                   source_text=full_text, match=match, pages=pages)
    if not structured.get("installation_id"):
        match = re.search(
            r"installation\s*(?:id|identifier|number|registration)\s*[:\-]\s*([A-Z0-9_\-]{3,})",
            full_text, flags=re.IGNORECASE,
        )
        if match:
            structured["installation_id"] = match.group(1).strip().upper()
            _append_regex_evidence(evidence, field="cbam.installation_id",
                                   value=structured["installation_id"],
                                   source_text=full_text, match=match, pages=pages)
    if not structured.get("production_route"):
        match = re.search(
            r"production\s*route\s*[:\-]\s*([A-Za-z0-9_\-/ ]+)",
            full_text, flags=re.IGNORECASE,
        )
        if match:
            structured["production_route"] = match.group(1).strip()
            _append_regex_evidence(evidence, field="cbam.production_route",
                                   value=structured["production_route"],
                                   source_text=full_text, match=match, pages=pages)
    if not structured.get("import_date"):
        match = re.search(
            r"(?:import|shipment|arrival|customs\s*clearance)\s*date\s*[:\-]\s*(\d{4}-\d{2}-\d{2})",
            full_text, flags=re.IGNORECASE,
        )
        if match:
            structured["import_date"] = match.group(1)
            _append_regex_evidence(evidence, field="cbam.import_date",
                                   value=structured["import_date"],
                                   source_text=full_text, match=match, pages=pages)
    if not structured.get("carbon_price_paid_eur"):
        match = re.search(
            r"carbon\s*(?:price|tax|levy|cost)\s*(?:paid|equivalent|already paid)?\s*[:\-]?\s*(?:EUR\s*)?([0-9]+(?:\.[0-9]+)?)",
            full_text, flags=re.IGNORECASE,
        )
        if match:
            structured["carbon_price_paid_eur"] = _parse_number(match.group(1))
            _append_regex_evidence(evidence, field="cbam.carbon_price_paid_eur",
                                   value=structured["carbon_price_paid_eur"],
                                   source_text=full_text, match=match, pages=pages)
    if not structured.get("carbon_price_paid_currency"):
        match = re.search(
            r"carbon\s*(?:price|tax|levy|cost)\s*(?:paid|equivalent)?\s*[:\-]?\s*([A-Z]{3})\s+[0-9]",
            full_text, flags=re.IGNORECASE,
        )
        if match:
            structured["carbon_price_paid_currency"] = match.group(1).upper()
            _append_regex_evidence(evidence, field="cbam.carbon_price_paid_currency",
                                   value=structured["carbon_price_paid_currency"],
                                   source_text=full_text, match=match, pages=pages)

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
        _extract_lines_from_text(body_text, evidence=evidence, field_prefix="lines", pages=pages)
        if body_text
        else []
    )
    if not extracted_lines:
        extracted_lines = _extract_lines_from_text(
            raw_text, evidence=evidence, field_prefix="lines", pages=pages
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
                "installation_id": structured.get("installation_id"),
                "installation_name": structured.get("installation_name"),
                "production_route": structured.get("production_route"),
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

    _ensure_value_evidence(evidence, field="invoice.invoice_number",
                           value=structured.get("invoice_number"),
                           text=raw_text, source="rule_value", pages=pages)
    _ensure_value_evidence(evidence, field="invoice.invoice_date",
                           value=structured.get("invoice_date"),
                           text=raw_text, source="rule_value", pages=pages)
    _ensure_value_evidence(evidence, field="importer.eori",
                           value=structured.get("importer_eori"),
                           text=raw_text, source="rule_value", pages=pages)

    return {
        "status": "parsed",
        "raw_text_preview": (raw_text or "")[:500],
        "flags": flags or [],
        "importer": {
            "name": structured.get("importer_name"),
            "eori": structured.get("importer_eori"),
        },
        "operator": {
            "operator_name": structured.get("operator_name"),
            "installation_name": structured.get("installation_name"),
            "installation_id": structured.get("installation_id"),
        },
        "invoice": {
            "invoice_number": structured.get("invoice_number"),
            "invoice_date": structured.get("invoice_date"),
            "import_date": structured.get("import_date"),
            "origin_country": structured.get("origin_country"),
            "incoterm": structured.get("incoterm"),
            "entry_reference": structured.get("entry_reference"),
        },
        "cbam": {
            "production_route": structured.get("production_route"),
            "carbon_price_paid_eur": structured.get("carbon_price_paid_eur"),
            "carbon_price_paid_currency": structured.get("carbon_price_paid_currency"),
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
