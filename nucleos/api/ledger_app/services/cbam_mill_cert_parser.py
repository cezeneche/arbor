"""CBAM Mill Certificate Parser (A1).

Parses EN 10204 3.1 / 3.2 steel and aluminium mill certificates to extract
quality and process data that supplements the main CBAM extraction pipeline.

Mill certificates are used as supporting evidence for the "actual" calculation
method for iron/steel and aluminium goods lines (EU 2023/1773 Art. 4(1)).

What is extracted
-----------------
- Heat/batch number
- Grade / alloy designation
- Product form (plate, coil, tube, rod, etc.)
- Chemical composition (C, Mn, Si, S, P, Cr, Ni, Mo, Al, N, etc.)
- Mechanical properties (yield strength, tensile strength, elongation, impact)
- Production route hint (BF-BOF / EAF / DRI from composition clues)

Output
------
The parser returns a supplementary dict (not a full extractor output) that
is intended to be merged into an existing goods line during the arbitration
step.  The caller (cbam_extractor or cbam_arbiter) is responsible for merging.

{
    "document_type": "mill_certificate",
    "certificate_type": "3.1" | "3.2" | "unknown",
    "heat_number": str | None,
    "grade": str | None,
    "product_form": str | None,
    "chemical_composition": {element: float, ...},
    "mechanical_properties": {property: float, ...},
    "production_route_hint": "BF_BOF" | "EAF" | "DRI_EAF" | None,
    "evidence": [EvidenceAtom dicts],
}

Detection heuristic
-------------------
The document is identified as a mill certificate if it contains at least two
of the following signals:
  - "certificate" near "inspection" or "test"
  - "EN 10204" reference or "3.1" / "3.2" designation
  - "heat number" or "charge number" or "melt"
  - Chemical composition section (C %, Mn %)

Regulation references
---------------------
EU 2023/1773, Article 4 — actual embedded emissions (requires certified data)
EN 10204 (European Standard) — types of inspection documents for metallic products
"""

from __future__ import annotations

import re
from typing import Any

# ── Detection signals ──────────────────────────────────────────────────────────

_CERT_SIGNALS = [
    re.compile(r"inspection\s+certificate", re.I),
    re.compile(r"test\s+certificate", re.I),
    re.compile(r"mill\s+cert(?:ificate)?", re.I),
    re.compile(r"material\s+certificate", re.I),
    re.compile(r"EN\s*10204", re.I),
    re.compile(r"\b3\s*[\.\-]\s*[12]\b"),          # 3.1 or 3.2
    re.compile(r"heat\s+number|charge\s+number|melt\s+no", re.I),
    re.compile(r"chemical\s+composition", re.I),
]

_MIN_SIGNAL_COUNT = 2


def is_mill_certificate(text: str) -> bool:
    """Return True if the document text looks like an EN 10204 mill certificate."""
    count = sum(1 for sig in _CERT_SIGNALS if sig.search(text))
    return count >= _MIN_SIGNAL_COUNT


# ── Certificate type (3.1 vs 3.2) ─────────────────────────────────────────────

_TYPE_32 = re.compile(r"\b3\s*[\.\-]\s*2\b")
_TYPE_31 = re.compile(r"\b3\s*[\.\-]\s*1\b")


def _detect_cert_type(text: str) -> str:
    if _TYPE_32.search(text):
        return "3.2"
    if _TYPE_31.search(text):
        return "3.1"
    return "unknown"


# ── Heat / batch number ────────────────────────────────────────────────────────

# The keyword is optionally followed by "number" / "no." / "#", which is then
# skipped rather than captured. The previous alternation listed "heat" before
# "heat\s+no\.?", and Python takes the first branch that matches, so the longer
# branches were unreachable and "Heat number: A4471928" captured "number".
#
# The value must contain a digit: heat numbers always do, and requiring one stops
# the pattern capturing whatever word follows the keyword.
_HEAT_RE = re.compile(
    r"(?:heat|charge|cast|melt)\s*(?:number|no\.?|#)?[:\s#\-]+"
    r"((?=[A-Z0-9\-/]*[0-9])[A-Z0-9][A-Z0-9\-/]{2,19})",
    re.I,
)


def _extract_heat_number(text: str) -> str | None:
    m = _HEAT_RE.search(text)
    return m.group(1).strip() if m else None


# ── Grade / alloy designation ──────────────────────────────────────────────────

_GRADE_RE = re.compile(
    r"(?:grade|steel\s+grade|material|alloy|designation|spec(?:ification)?)[:\s]+([A-Z0-9\-/\s]{2,30}?)(?:\n|,|\s{2,}|$)",
    re.I,
)


def _extract_grade(text: str) -> str | None:
    m = _GRADE_RE.search(text)
    return m.group(1).strip() if m else None


# ── Product form ───────────────────────────────────────────────────────────────

_PRODUCT_FORMS = [
    "plate", "sheet", "coil", "strip", "tube", "pipe", "rod", "bar",
    "wire", "section", "angle", "channel", "beam", "rail", "bloom",
    "billet", "slab", "ingot", "forging", "casting",
]
_PRODUCT_FORM_RE = re.compile(
    r"\b(" + "|".join(_PRODUCT_FORMS) + r")s?\b",
    re.I,
)


def _extract_product_form(text: str) -> str | None:
    m = _PRODUCT_FORM_RE.search(text)
    return m.group(1).lower() if m else None


# ── Chemical composition ───────────────────────────────────────────────────────

_ELEMENT_SYMBOLS = [
    "C", "Mn", "Si", "S", "P", "Cr", "Ni", "Mo", "V", "Cu",
    "Al", "N", "B", "Ti", "Nb", "Co", "Sn", "Pb", "As", "Sb",
    "Zn", "Mg", "Fe", "Ca",
]
# Matches "C : 0.18" or "Carbon 0.18 %" or "C  0.18" etc.
_ELEM_RE = re.compile(
    r"(?<!\w)({elements})\s*[:\s%]\s*(\d+\.?\d*)(?:\s*%)?".format(
        elements="|".join(_ELEMENT_SYMBOLS)
    ),
)


def _extract_chemical_composition(text: str) -> dict[str, float]:
    composition: dict[str, float] = {}
    for m in _ELEM_RE.finditer(text):
        element = m.group(1).upper()
        try:
            value = float(m.group(2))
        except ValueError:
            continue
        # Basic sanity: composition % should be ≤ 100
        if 0 < value <= 100:
            composition[element] = value
    return composition


# ── Mechanical properties ──────────────────────────────────────────────────────

_MECH_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("yield_strength_mpa", re.compile(r"(?:yield|reh?l?|r[pe]0?\.?2|proof)\s*(?:strength)?[:\s]+(\d+\.?\d*)\s*(?:N/mm²|MPa|mpa)?", re.I)),
    ("tensile_strength_mpa", re.compile(r"(?:tensile|rm|uts|ultimate)\s*(?:strength)?[:\s]+(\d+\.?\d*)\s*(?:N/mm²|MPa|mpa)?", re.I)),
    ("elongation_pct", re.compile(r"(?:elongation|A\d*)[:\s%]+(\d+\.?\d*)\s*%?", re.I)),
    ("impact_energy_j", re.compile(r"(?:charpy|impact|KV\d?)[:\s]+(\d+\.?\d*)\s*J?", re.I)),
]


def _extract_mechanical_properties(text: str) -> dict[str, float]:
    props: dict[str, float] = {}
    for name, pattern in _MECH_PATTERNS:
        m = pattern.search(text)
        if m:
            try:
                props[name] = float(m.group(1))
            except ValueError:
                pass
    return props


# ── Production route heuristic from chemical composition ──────────────────────
#
# Rules (approximate):
#   - High P (>0.015%) + High S (>0.015%) + low Cr → likely BF-BOF (basic oxygen process)
#   - Very low P + low S + possibly higher Cr/Ni → EAF (electric arc furnace, scrap-based)
#   - Low C (<0.05%) + elevated H → possibly DRI-EAF (direct reduction iron)
#   These are engineering estimates only; the actual route must be confirmed by the producer.

def _infer_production_route(composition: dict[str, float]) -> str | None:
    """Infer the production route from residual elements.

    Keys are upper-cased by _extract_chemical_composition, so lookups must be
    too. Reading "Cr" and "Ni" against a dict holding "CR" and "NI" returned 0.0
    every time, which made the EAF branch unreachable for every document —
    scrap-based steel was never identified as such, and Annex VI defaults are
    differentiated by production route.
    """
    if not composition:
        return None

    p = composition.get("P", 0.0)
    s = composition.get("S", 0.0)
    c = composition.get("C", 0.0)
    cr = composition.get("CR", 0.0)
    ni = composition.get("NI", 0.0)

    # High residuals → EAF (scrap-based)
    if cr + ni > 0.5 and p < 0.020:
        return "EAF"

    # Low residuals + high P/S → BF-BOF (virgin iron)
    if p > 0.015 and s > 0.015 and cr < 0.2:
        return "BF_BOF"

    # Ultra-low carbon, low P, low S → possibly DRI
    if c < 0.05 and p < 0.010 and s < 0.010:
        return "DRI_EAF"

    return None


# ── Public API ────────────────────────────────────────────────────────────────

def parse_mill_certificate(text: str, layout: dict | None = None) -> dict[str, Any]:
    """Extract mill certificate data from document text.

    Parameters
    ----------
    text:
        Raw text extracted from the document (via pdfplumber or OCR).
    layout:
        Optional layout dict from ``document_text_extractor`` (not currently used
        but reserved for future spatial extraction improvements).

    Returns
    -------
    Supplementary dict with certificate fields.  Returns ``None`` for most
    fields if the document cannot be identified as a mill certificate.

    Note: This returns a *supplementary* dict, not a full extractor output.
    Merge into the goods line via ``cbam_arbiter`` or ``cbam_repair``.
    """
    cert_type = _detect_cert_type(text)
    heat_number = _extract_heat_number(text)
    grade = _extract_grade(text)
    product_form = _extract_product_form(text)
    composition = _extract_chemical_composition(text)
    mech_props = _extract_mechanical_properties(text)
    route_hint = _infer_production_route(composition)

    evidence: list[dict] = []
    if heat_number:
        evidence.append({"field": "heat_number", "value": heat_number,
                         "source": "mill_cert_parser", "confidence": 0.90, "snippet": None})
    if grade:
        evidence.append({"field": "grade", "value": grade,
                         "source": "mill_cert_parser", "confidence": 0.80, "snippet": None})
    if composition:
        evidence.append({"field": "chemical_composition", "value": composition,
                         "source": "mill_cert_parser", "confidence": 0.85, "snippet": None})
    if route_hint:
        evidence.append({"field": "production_route_hint", "value": route_hint,
                         "source": "mill_cert_parser", "confidence": 0.55, "snippet": None})

    return {
        "document_type": "mill_certificate",
        "certificate_type": cert_type,
        "heat_number": heat_number,
        "grade": grade,
        "product_form": product_form,
        "chemical_composition": composition,
        "mechanical_properties": mech_props,
        "production_route_hint": route_hint,
        "evidence": evidence,
    }
