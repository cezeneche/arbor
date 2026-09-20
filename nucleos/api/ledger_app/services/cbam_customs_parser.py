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
from typing import Any, NamedTuple

from ledger_app.services.cbam_extraction._evidence import _append_evidence_atom
from ledger_app.services.cbam_customs_labels import (
    as_country,
    as_cn_code,
    as_eori,
    as_mass_kg,
    labelled_values,
    recognised_field_count,
)

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

# A declaration in German, or an English one scanned badly, matches none of the
# signals above and was never read at all. Labelling three of the fields a
# declaration carries is the same evidence in another form; three rather than
# two because these are matched by closeness, and an invoice labels one or two
# of them in passing.
_MIN_RECOGNISED_LABELS = 3

# A document that names itself is taken at its word. An invoice for an import
# carries everything a declaration does — EORI, CN code, net mass, origin — and
# labels all of it, so counting labels alone made it a declaration and put the
# customs parser in competition for fields it should not claim. Inference is for
# documents that say nothing about what they are.
_DECLARES_ANOTHER_TYPE = re.compile(
    r"^\W*(?:commercial\s+invoice|proforma\s+invoice|packing\s+list|bill\s+of\s+lading"
    r"|delivery\s+note|consignment\s+note|inspection\s+certificate|test\s+certificate"
    r"|electricity\s+bill|gas\s+bill|purchase\s+order)\b",
    re.I | re.M,
)


# Arbor's transcription renders a form's table as pipe-separated columns —
# "Net mass | 24 500 kg" — and a pipe between a label and its value defeats
# every pattern that expects whitespace there. Two spaces is what the same
# table looks like from a PDF text layer, which is what the patterns are
# written for.
_TABLE_PIPE = re.compile(r"[ \t]*\|[ \t]*")


def _without_table_pipes(text: str) -> str:
    return _TABLE_PIPE.sub("  ", text)


def is_customs_declaration(text: str) -> bool:
    """Return True if text looks like a customs declaration form."""
    text = _without_table_pipes(text)
    if sum(1 for s in _CUSTOMS_SIGNALS if s.search(text)) >= _MIN_SIGNALS:
        return True
    if _DECLARES_ANOTHER_TYPE.search(text):
        return False
    return recognised_field_count(text) >= _MIN_RECOGNISED_LABELS


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


class Found(NamedTuple):
    """A value and where it was read from.

    A reviewer confirms a value against the text it came from, and Arbor cannot
    certify a record Verified without it. Returning the value alone meant
    everything this parser found arrived unconfirmable.
    """

    value: Any
    start: int
    end: int


def _found(value: Any, m: re.Match[str], group: int = 1) -> Found | None:
    if value in (None, ""):
        return None
    try:
        return Found(value, m.start(group), m.end(group))
    except IndexError:
        return Found(value, m.start(0), m.end(0))


def _shift(found: Found | None, offset: int) -> Found | None:
    """A block-relative position restated against the whole document."""
    if found is None or offset == 0:
        return found
    return Found(found.value, found.start + offset, found.end + offset)


def _cn_from_match(m: re.Match[str]) -> str | None:
    digits = re.sub(r"\D", "", m.group(1))
    return digits[:8] if len(digits) >= 8 else None  # 10-digit TARIC: CN is the first 8


def _extract_cn_code(text: str) -> Found | None:
    for m in _CN_CODE_RE.finditer(text):
        code = _cn_from_match(m)
        if code:
            return _found(code, m)
    m = _CN_CODE_BARE_RE.search(text)
    return _found(m.group(1), m) if m else None


# Box 8 / consignee EORI.
#
# The country prefix must start a word and be followed by a digit. Without both,
# "IMPORTER / DECLARANT" parses as an EORI: DE is a country code and CLARANT
# satisfies a letters-allowed tail, so the label is recorded as the importer's
# identifier. The value may also sit on the line below its label.
_EORI_COUNTRY = (
    r"AT|BE|BG|CY|CZ|DE|DK|EE|ES|FI|FR|GB|GR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK"
)
# The tail is digits, optionally spaced as the form prints them. Admitting
# letters let "Box 8 Consignee GB247188003000 Acme Steel Ltd" run the company
# name into the identifier: GB247188003000ACM.
_EORI_BODY = rf"(?:{_EORI_COUNTRY})\s?[0-9](?:[0-9 ]{{3,16}}[0-9])?"
#
# A VAT number sits beside the EORI on the same form and wears the same country
# prefix — "Importer VAT GB 247 1880 03" against "Importer EORI GB247188003000".
# Read as the EORI it files the entry under an identifier the importer does not
# trade under, so any label mentioning VAT disqualifies what follows it.
_VAT_LABEL_RE = re.compile(r"\b(?:vat|tva|ust|btw|tax)\b", re.I)
_CONSIGNEE_RE = re.compile(
    rf"(?:box\s*8|consignee|importer|declarant)(?:\s*eori)?[:\s]*(?:[^\n]*\n)?\s*\b({_EORI_BODY})",
    re.I,
)
_EORI_BARE_RE = re.compile(rf"\b({_EORI_BODY})", re.I)


def _labelled_vat(text: str, start: int) -> bool:
    """Whether the identifier starting at `start` is introduced as a VAT number."""
    line_start = text.rfind("\n", 0, start) + 1
    preceding_line_start = text.rfind("\n", 0, max(line_start - 1, 0)) + 1
    return bool(_VAT_LABEL_RE.search(text[preceding_line_start:start]))


def _clean_eori(raw: str) -> str:
    return raw.strip().replace(" ", "").replace("-", "").upper()


def _extract_consignee_eori(text: str) -> Found | None:
    for pattern in (_CONSIGNEE_RE, _EORI_BARE_RE):
        for m in pattern.finditer(text):
            if not _labelled_vat(text, m.start(1)):
                return _found(_clean_eori(m.group(1)), m)
    return None


# Box 34 / country of origin (ISO 2-letter)
# Forms suffix the label ("Country of origin code") and abbreviate it to
# "Origin:" in column headings; both left origin_country null, and origin decides
# CBAM scope and the electricity factor.
_ORIGIN_RE = re.compile(
    r"(?:box\s*34|country\s+of\s+origin|origin\s+country|country\s+code|origin)"
    r"(?:\s+code)?[:\s]*([A-Z]{2})\b(?![A-Za-z])",
    re.I,
)


def _extract_origin_country(text: str) -> Found | None:
    m = _ORIGIN_RE.search(text)
    return _found(m.group(1).upper(), m) if m else None


# Box 35 / net mass (kg)
# The capture must begin and end with a digit. Allowing the class to match
# whitespace alone let "Box 35 Net mass: 24,500.00 kg" satisfy the pattern on
# the Box-35 keyword with a single space as the value, so the mass was never read.
#
# The unit is often printed as part of the label — "Net mass (kg) 24 500" — and
# a parenthesis between label and value left the mass unread.
_MASS_RE = re.compile(
    r"(?:box\s*3[58]|net\s+mass|net\s+weight|nett\s+weight|nett\s+mass)"
    r"\s*(?:\((?:kg|kgs|kilograms?)\))?"
    r"[:\s]*([0-9][0-9.,\s ]*[0-9]|[0-9])\s*(?:kg|kgs|kilogram)?",
    re.I,
)


_DESCRIPTION_RE = re.compile(
    r"(?:goods\s+description|description\s+of\s+goods|box\s*31|description)[:\s]*([^\n]{3,200})",
    re.I,
)

# A total at the foot of the page describes the whole entry, not an item. Read as
# an item's mass it would double the declaration.
_TOTAL_MASS_RE = re.compile(r"total\s+net\s+(?:mass|weight)", re.I)


def _extract_description(text: str) -> Found | None:
    m = _DESCRIPTION_RE.search(text)
    return _found(m.group(1).strip(), m) if m else None


# A goods table prints one item per row: an optional item number, the code, a
# description, and the mass in the last column. There is no label beside any of
# it, so the label-driven patterns find a heading and nothing under it.
_TABLE_ROW_RE = re.compile(
    r"^[ \t]*(?:[0-9]{1,3}[ \t]+)?"
    r"([0-9]{8}|[0-9]{4}[ \t][0-9]{4})[ \t]+"
    r"(\S.*?)[ \t]+"
    r"([0-9][0-9., ]*[0-9])[ \t]*$",
    re.M,
)


def _table_items(text: str) -> list[dict[str, Any]]:
    from ledger_app.services.cbam_extraction._validators import (  # noqa: PLC0415
        parse_quantity,
    )

    items: list[dict[str, Any]] = []
    for m in _TABLE_ROW_RE.finditer(text):
        mass = m.group(3).strip()
        if not _WELL_FORMED_NUMBER.fullmatch(mass):
            continue
        items.append({
            "cn_code": _found(re.sub(r"\D", "", m.group(1)), m, 1),
            "net_mass_kg": _found(parse_quantity(mass)[0], m, 3),
            "description": _found(m.group(2).strip(), m, 2),
        })
    return items


def _goods_blocks(text: str) -> list[tuple[str, int]]:
    """The text of each goods item: from its commodity code to the next one.

    A declaration routinely covers several commodity codes. Reading the whole
    document for one code and one mass produced a single line, so every item
    after the first was dropped and the case understated the import — without
    looking incomplete, which is what made it dangerous.
    """
    starts = [m.start() for m in _CN_CODE_RE.finditer(text) if _cn_from_match(m)]
    if len(starts) < 2:
        return [(text, 0)]
    bounds = [*starts, len(text)]
    return [(text[bounds[i]:bounds[i + 1]], bounds[i]) for i in range(len(starts))]


# A separator inside a number groups thousands: one character, between groups of
# exactly three digits, in whichever of the conventions the form uses — 24 500,
# 24,500.00, 24.500,50. Anything looser reads two values that happen to sit next
# to each other as one. parse_quantity still decides which separator is decimal.
_WELL_FORMED_NUMBER = re.compile(
    r"[0-9]{1,3}(?:[., ][0-9]{3})*(?:[.,][0-9]{1,3})?|[0-9]+(?:[.,][0-9]+)?"
)


def _extract_net_mass_kg(text: str) -> Found | None:
    """Net mass in kilograms, in whichever separator convention the form uses.

    Stripping every comma unconditionally turned the European "24,5" into 245.
    parse_quantity decides which separator is the decimal point.
    """
    from ledger_app.services.cbam_extraction._validators import (  # noqa: PLC0415
        parse_quantity,
    )

    for m in _MASS_RE.finditer(text):
        preceding = text[max(0, m.start() - 12):m.start()]
        if _TOTAL_MASS_RE.search(preceding + m.group(0)):
            continue
        if not _WELL_FORMED_NUMBER.fullmatch(m.group(1).strip()):
            # Under a column heading — "Net mass (kg)" then a row below — the
            # capture ran across the newline and took the item number with the
            # code: 172083900 kg, from an item of 24 500.
            continue
        return _found(parse_quantity(m.group(1))[0], m)
    return None


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


def _extract_mrn(text: str) -> Found | None:
    m = _MRN_RE.search(text)
    if m:
        return _found(m.group(1).upper(), m)
    m = _MRN_BARE_RE.search(text)
    return _found(m.group(1).upper(), m) if m else None


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


def _extract_invoice_number(text: str) -> Found | None:
    # An invoice number carries a digit; a word that happens to follow the
    # keyword does not.
    for m in _INVOICE_RE.finditer(text):
        candidate = m.group(1).strip()
        if any(ch.isdigit() for ch in candidate):
            return _found(candidate, m)
    return None


# Customs procedure code (4-digit SAC)
_CPC_RE = re.compile(
    r"(?:procedure|CPC|customs\s+procedure)[:\s]*([0-9]{4,6})",
    re.I,
)


def _extract_customs_procedure(text: str) -> Found | None:
    m = _CPC_RE.search(text)
    return _found(m.group(1), m) if m else None


# Public API

def _fill_from_labels(
    text: str,
    items: list[dict[str, Any]],
    origin: Found | None,
    eori: Found | None,
) -> tuple[list[dict[str, Any]], Found | None, Found | None]:
    from ledger_app.services.cbam_extraction._validators import (  # noqa: PLC0415
        parse_quantity,
    )

    labelled = labelled_values(text)

    def _first(field: str, convert: Any) -> Found | None:
        for value, at in labelled.get(field, []):
            converted = convert(value)
            if converted not in (None, ""):
                return Found(converted, at, at + len(value))
        return None

    if not items:
        codes = [
            Found(code, at, at + len(value))
            for value, at in labelled.get("cn_code", [])
            if (code := as_cn_code(value))
        ]
        masses = [
            Found(mass, at, at + len(value))
            for value, at in labelled.get("net_mass", [])
            if (mass := as_mass_kg(value, _WELL_FORMED_NUMBER, parse_quantity)) is not None
        ]
        items = [
            {
                "cn_code": code,
                # Positional: the nth code goes with the nth mass, which is how a
                # form lists them. A mass with no code of its own stays unclaimed.
                "net_mass_kg": masses[index] if index < len(masses) else None,
                "description": None,
            }
            for index, code in enumerate(codes)
        ]

    if origin is None:
        origin = _first("origin_country", as_country)

    if not eori:
        eori = _first("importer_eori", lambda value: as_eori(value, _EORI_COUNTRY))

    return items, origin, eori


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
    text = _without_table_pipes(text)
    items = _table_items(text) or [
        {
            "cn_code": _shift(code, offset),
            "net_mass_kg": _shift(_extract_net_mass_kg(block), offset),
            "description": _shift(_extract_description(block), offset),
        }
        for block, offset in _goods_blocks(text)
        if (code := _extract_cn_code(block))
    ]

    eori = _extract_consignee_eori(text)
    origin = _extract_origin_country(text)
    mrn = _extract_mrn(text)

    # Whatever the exact patterns did not find, look for under a label that
    # merely resembles one we know — another language, or OCR damage. The value
    # still has to prove its shape, so this recovers a reading, never invents one.
    if not items or origin is None or not eori:
        items, origin, eori = _fill_from_labels(text, items, origin, eori)
    invoice_number = _extract_invoice_number(text)
    customs_procedure = _extract_customs_procedure(text)

    evidence: list[dict] = []

    def _ev(field: str, found: Found | None, conf: float = 0.85) -> None:
        """Record a value with the text it was read from.

        Every atom carries a snippet and a span: a reviewer confirms the value
        against the document, and without that text Arbor cannot certify the
        record Verified however sure the parser was.
        """
        if found is None or found.value in (None, ""):
            return
        _append_evidence_atom(
            evidence,
            field=field,
            value=found.value,
            source="customs_parser",
            text=text,
            start=found.start,
            end=found.end,
            confidence=conf,
        )

    _ev("importer.eori", eori, 0.88)
    _ev("invoice.origin_country", origin, 0.90)
    _ev("invoice.entry_reference", mrn, 0.95)
    _ev("invoice.invoice_number", invoice_number, 0.80)
    for index, item in enumerate(items):
        _ev(f"lines[{index}].cn_code", item["cn_code"], 0.92)
        _ev(f"lines[{index}].net_mass_kg", item["net_mass_kg"], 0.88)

    if not items:
        # No CN code, so no goods line — but a declared mass is still shipment
        # evidence the caller merges into an existing case, and dropping it
        # would lose the one figure the document did carry.
        _ev("lines[0].net_mass_kg", _extract_net_mass_kg(text), 0.88)

    lines = []
    for item in items:
        mass = item["net_mass_kg"]
        mass_kg = mass.value if mass else None
        lines.append({
            "cn_code": item["cn_code"].value,
            "description": item["description"].value if item["description"] else None,
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
            "eori": eori.value if eori else "",
        },
        "invoice": {
            "invoice_number": invoice_number.value if invoice_number else None,
            "invoice_date": None,
            "origin_country": origin.value if origin else None,
            "incoterm": None,
            "entry_reference": mrn.value if mrn else None,
        },
        "lines": lines,
        "emissions": {
            "method": None,
            "direct_embedded_kgco2e": 0.0,
            "indirect_embedded_kgco2e": 0.0,
        },
        "document_type": "customs_declaration",
        "customs_procedure": customs_procedure.value if customs_procedure else None,
        "reporting_year": None,
        "reporting_quarter": None,
        "evidence": evidence,
    }
