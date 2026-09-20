"""CBAM Customs Declaration Parser — SAD / CDS / CN22 (A3).

Extracts structured CBAM-relevant fields from EU Single Administrative Document
(SAD / Form C88), HMRC CDS (Customs Declaration Service) entries, and CN22
postal customs forms.

The customs declaration is often the most authoritative source for:
  - CN code (Box 33 on SAD / commodity code on CDS)
  - Net mass (Box 35)
  - Country of origin (Box 34)
  - Consignee EORI (Box 8)
  - Entry reference / MRN (Box 7 / MRN)

Output shape (mirrors cbam_extractor output)
--------------------------------------------
Same dict structure as cbam_xml_declaration_parser output.

Detection
---------
Document is identified as a customs declaration if it contains at least 2 of:
  - "Single Administrative Document" / "SAD" / "C88"
  - Box number references ("Box 1", "Box 33")
  - "MRN" (Movement Reference Number)
  - "customs procedure code" / "CPC"
  - "EORI" near a consignee reference
  - CN22 header keyword

Regulation references
---------------------
EU Regulation 952/2013 (Union Customs Code), Annex B — SAD field definitions
HMRC CDS (UK Customs Declaration Service) technical specification
UPU S10 / CN22 / CN23 — postal customs forms
"""

from __future__ import annotations

import re
from typing import Any

# Detection signals

_CUSTOMS_SIGNALS = [
    re.compile(r"single\s+administrative\s+document", re.I),
    re.compile(r"\bSAD\b"),
    re.compile(r"\bC88\b"),
    re.compile(r"\bCN22\b|\bCN23\b"),
    re.compile(r"movement\s+reference\s+number|MRN", re.I),
    re.compile(r"customs\s+procedure\s+code|CPC", re.I),
    re.compile(r"commodity\s+code", re.I),
    re.compile(r"box\s+33|box33", re.I),
    re.compile(r"declarant\s+EORI|consignee\s+EORI", re.I),
]

_MIN_SIGNALS = 2


def is_customs_declaration(text: str) -> bool:
    """Return True if text looks like a customs declaration form."""
    return sum(1 for s in _CUSTOMS_SIGNALS if s.search(text)) >= _MIN_SIGNALS


# Field extractors

# SAD Box 33 / CDS commodity code: 8-digit CN code
# Declarations group the digits of a CN code — "7208 3900", "7208 39 00" — and
# the label may sit on its own line above the value. Requiring eight consecutive
# digits matched none of that, and without a CN code there is no goods line and
# so no case at all. Spaces and dots are admitted between digits but newlines are
# not, or the code would be assembled from two different fields.
_CN_CODE_RE = re.compile(
    r"(?:box\s*33|commodity\s+code|cn\s+code|tariff\s+code|hs\s+code)"
    r"[^0-9]{0,30}([0-9][0-9 .]{6,14}[0-9])",
    re.I,
)
_CN_CODE_BARE_RE = re.compile(r"\b([0-9]{8})\b")  # fallback: 8-digit standalone


def _extract_cn_code(text: str) -> str | None:
    m = _CN_CODE_RE.search(text)
    if m:
        digits = re.sub(r"\D", "", m.group(1))
        if len(digits) >= 8:
            return digits[:8]  # 10-digit TARIC carries the CN code in its first 8
    m = _CN_CODE_BARE_RE.search(text)
    return m.group(1) if m else None


# Box 8 / consignee EORI.
#
# The country prefix must start a word and be followed by a digit. Without both,
# "IMPORTER / DECLARANT" parses as an EORI: DE is a country code and CLARANT
# satisfies a letters-allowed tail, so the label is recorded as the importer's
# identifier. The value may also sit on the line below its label.
_EORI_COUNTRY = (
    r"AT|BE|BG|CY|CZ|DE|DK|EE|ES|FI|FR|GB|GR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK"
)
_EORI_BODY = rf"(?:{_EORI_COUNTRY})\s?[0-9][0-9A-Z\- ]{{4,16}}"
_CONSIGNEE_RE = re.compile(
    rf"(?:box\s*8|consignee|importer|declarant)(?:\s*eori)?[:\s]*(?:[^\n]*\n)?\s*\b({_EORI_BODY})",
    re.I,
)
_EORI_BARE_RE = re.compile(rf"\b({_EORI_BODY})", re.I)


def _clean_eori(raw: str) -> str:
    return raw.strip().replace(" ", "").replace("-", "").upper()


def _extract_consignee_eori(text: str) -> str | None:
    m = _CONSIGNEE_RE.search(text) or _EORI_BARE_RE.search(text)
    return _clean_eori(m.group(1)) if m else None


# Box 34 / country of origin (ISO 2-letter)
_ORIGIN_RE = re.compile(
    r"(?:box\s*34|country\s+of\s+origin|origin\s+country|country\s+code)"
    r"[:\s]*([A-Z]{2})\b",
    re.I,
)


def _extract_origin_country(text: str) -> str | None:
    m = _ORIGIN_RE.search(text)
    return m.group(1).upper() if m else None


# Box 35 / net mass (kg)
# The capture must begin and end with a digit. Allowing the class to match
# whitespace alone let "Box 35 Net mass: 24,500.00 kg" satisfy the pattern on
# the Box-35 keyword with a single space as the value, so the mass was never read.
_MASS_RE = re.compile(
    r"(?:box\s*35|net\s+mass|net\s+weight|nett\s+weight|nett\s+mass)"
    r"[:\s]*([0-9][0-9.,\s ]*[0-9]|[0-9])\s*(?:kg|kgs|kilogram)?",
    re.I,
)


def _extract_net_mass_kg(text: str) -> float | None:
    """Net mass in kilograms, in whichever separator convention the form uses.

    Stripping every comma unconditionally turned the European "24,5" into 245.
    parse_quantity decides which separator is the decimal point.
    """
    from ledger_app.services.cbam_extraction._validators import (  # noqa: PLC0415
        parse_quantity,
    )

    m = _MASS_RE.search(text)
    if not m:
        return None
    return parse_quantity(m.group(1))[0]


# Box 7 / MRN (Movement Reference Number) — 18 characters:
#   2 digits (year) + 2 letters (country) + 14 alphanumeric.
# The pattern previously required a trailing [A-Z][0-9], making it 20 characters,
# so no genuine MRN could ever match and entry_reference was always None.
_MRN_BODY = r"[0-9]{2}[A-Z]{2}[0-9A-Z]{14}"
_MRN_RE = re.compile(
    r"(?:MRN|movement\s+reference|entry\s+reference|box\s*7)[:\s]*"
    rf"({_MRN_BODY})",
    re.I,
)
_MRN_BARE_RE = re.compile(rf"\b({_MRN_BODY})\b", re.I)


def _extract_mrn(text: str) -> str | None:
    m = _MRN_RE.search(text)
    if m:
        return m.group(1).upper()
    m = _MRN_BARE_RE.search(text)
    return m.group(1).upper() if m else None


# Box 44 / additional information (often has invoice reference)
# The keyword must be a whole word. Without the trailing boundary, "REF" matches
# inside "DECLARATION REFERENCE" and the capture takes what is left of the word:
# an invoice number of ERENCE, plausible enough to travel unquestioned.
#
# "Invoice" also opens the labels of neighbouring fields — invoice value,
# invoice amount, invoice date — whose label word or money figure would
# otherwise be recorded as the number.
_NEIGHBOURING_LABEL = r"(?!\s*(?:value|amount|total|sum|price|currency|date)\b)"
_INVOICE_RE = re.compile(
    rf"\b(?:commercial\s+invoice|invoice|ref(?:erence)?)\b{_NEIGHBOURING_LABEL}"
    r"[:\s#\-]*([A-Z0-9][A-Z0-9\-/]{2,29})\b",
    re.I,
)


def _extract_invoice_number(text: str) -> str | None:
    # An invoice number carries a digit; a word that happens to follow the
    # keyword does not.
    for m in _INVOICE_RE.finditer(text):
        candidate = m.group(1).strip()
        if any(ch.isdigit() for ch in candidate):
            return candidate
    return None


# Customs procedure code (4-digit SAC)
_CPC_RE = re.compile(
    r"(?:procedure|CPC|customs\s+procedure)[:\s]*([0-9]{4,6})",
    re.I,
)


def _extract_customs_procedure(text: str) -> str | None:
    m = _CPC_RE.search(text)
    return m.group(1) if m else None


# Public API

def parse_customs_declaration(text: str, layout: dict | None = None) -> dict[str, Any]:
    """Extract CBAM-relevant fields from a customs declaration document.

    Parameters
    ----------
    text:
        Raw text from the document (pdfplumber or OCR).
    layout:
        Optional layout dict (reserved for future spatial extraction).

    Returns
    -------
    Standard extractor output dict with ``document_type = "customs_declaration"``.

    If no CN code is found, ``lines`` will be empty.  The caller should merge
    shipment-level fields (MRN, origin, consignee) with an existing case.
    """
    cn_code = _extract_cn_code(text)
    eori = _extract_consignee_eori(text)
    origin = _extract_origin_country(text)
    mass_kg = _extract_net_mass_kg(text)
    mrn = _extract_mrn(text)
    invoice_number = _extract_invoice_number(text)
    customs_procedure = _extract_customs_procedure(text)

    evidence: list[dict] = []

    def _ev(field, value, conf=0.85):
        if value:
            evidence.append({"field": field, "value": value,
                              "source": "customs_parser", "confidence": conf, "snippet": None})

    _ev("importer.eori", eori, 0.88)
    _ev("invoice.origin_country", origin, 0.90)
    _ev("invoice.entry_reference", mrn, 0.95)
    _ev("invoice.invoice_number", invoice_number, 0.80)
    if cn_code:
        _ev("lines[0].cn_code", cn_code, 0.92)
    if mass_kg:
        _ev("lines[0].net_mass_kg", mass_kg, 0.88)

    lines = []
    if cn_code:
        lines.append({
            "cn_code": cn_code,
            "description": None,
            "quantity": mass_kg / 1000.0 if mass_kg else None,
            "quantity_unit": "t",
            "net_mass_kg": mass_kg,
            "method": "default",
            "direct_embedded_kgco2e": None,
            "indirect_embedded_kgco2e": 0.0,
        })

    return {
        "importer": {
            "name": None,
            "eori": eori or "",
        },
        "invoice": {
            "invoice_number": invoice_number,
            "invoice_date": None,
            "origin_country": origin,
            "incoterm": None,
            "entry_reference": mrn,
        },
        "lines": lines,
        "emissions": {
            "method": None,
            "direct_embedded_kgco2e": 0.0,
            "indirect_embedded_kgco2e": 0.0,
        },
        "document_type": "customs_declaration",
        "customs_procedure": customs_procedure,
        "reporting_year": None,
        "reporting_quarter": None,
        "evidence": evidence,
    }
