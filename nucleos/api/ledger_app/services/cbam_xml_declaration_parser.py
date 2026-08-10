"""CBAM EU Transitional Registry XML Declaration Parser (A2).

Parses the official EC CBAM XML declaration format
(``urn:ec.europa.eu:taxud:cbam:declaration:v1``) into the same dict shape
that ``cbam_extractor.py`` produces.

This allows the standard CBAM pipeline to ingest operator-supplied XML
declarations (from the EU Transitional Registry portal or from third-country
installation operators) without changes to the extraction or arbitration layers.

Supported input formats
-----------------------
1. ``<cbam:quarterlyDeclaration>`` — importer quarterly submission
2. ``<cbam:operatorDeclaration>``  — installation operator embedded emissions report

Output shape (mirrors cbam_extractor output)
--------------------------------------------
{
    "importer": {"name": str | None, "eori": str},
    "invoice": {
        "invoice_number": None,        # XML declarations have no invoice number
        "invoice_date": None,
        "origin_country": str | None,
        "incoterm": None,
        "entry_reference": None,
    },
    "lines": [
        {
            "cn_code": str,
            "description": str | None,
            "quantity": float | None,
            "quantity_unit": "t",
            "net_mass_kg": float | None,      # net_mass_t × 1000
            "method": "actual" | "default" | "estimated",
            "direct_embedded_kgco2e": float,   # direct_tco2e × 1000
            "indirect_embedded_kgco2e": float,
        },
        ...
    ],
    "emissions": {
        "method": str | None,
        "direct_embedded_kgco2e": float,
        "indirect_embedded_kgco2e": float,
    },
    "document_type": "cbam_xml_declaration",
    "evidence": [EvidenceAtom dicts],
}

Regulation references
---------------------
EU Regulation 2023/956, Art. 6 (information to be submitted)
EC DG TAXUD — CBAM Transitional Registry XML Schema Guide (Dec 2023)
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any
from xml.etree import ElementTree as ET

_CBAM_NS = "urn:ec.europa.eu:taxud:cbam:declaration:v1"
_D = Decimal
_ZERO = _D("0")

# Fallback namespace patterns for documents that don't use the canonical NS
_ALT_NS_PATTERNS = [
    re.compile(r"urn:ec\.europa\.eu:taxud:cbam:[^:]+:v\d+"),
    re.compile(r"cbam"),
]


def _tag(ns: str, name: str) -> str:
    return f"{{{ns}}}{name}"


def _find_text(el: ET.Element, ns: str, *names: str) -> str | None:
    """Traverse a path of element names and return the text of the last one."""
    current = el
    for name in names:
        child = current.find(_tag(ns, name))
        if child is None:
            # Try without namespace
            child = current.find(name)
        if child is None:
            return None
        current = child
    return current.text.strip() if current.text else None


def _to_float(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value.strip().replace(",", "."))
    except (ValueError, AttributeError):
        return None


def _to_decimal(value: str | None) -> Decimal | None:
    if not value:
        return None
    try:
        return _D(value.strip().replace(",", "."))
    except (InvalidOperation, AttributeError):
        return None


def _detect_namespace(root: ET.Element) -> str:
    """Detect the CBAM namespace from the root element's tag."""
    tag = root.tag
    if tag.startswith("{"):
        ns = tag[1:tag.index("}")]
        return ns
    return ""


def _evidence(field: str, value: Any, source: str = "xml_parser", confidence: float = 0.95) -> dict:
    return {
        "field": field,
        "value": value,
        "source": source,
        "confidence": confidence,
        "snippet": None,
    }


def parse_cbam_xml_declaration(xml_bytes: bytes) -> dict[str, Any]:
    """Parse an EC CBAM XML declaration into the standard extractor output dict.

    Parameters
    ----------
    xml_bytes:
        Raw bytes of the XML document.

    Returns
    -------
    Dict matching the cbam_extractor output shape.

    Raises
    ------
    ValueError
        If the document cannot be parsed as XML or does not contain recognisable
        CBAM declaration elements.
    """
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise ValueError(f"XML parse error: {exc}") from exc

    ns = _detect_namespace(root)

    def _t(*path: str) -> str | None:
        return _find_text(root, ns, *path)

    # ── Detect document type
    local_tag = root.tag.split("}")[-1] if "}" in root.tag else root.tag
    is_quarterly = "quarterly" in local_tag.lower() or "declaration" in local_tag.lower()

    evidence: list[dict] = []

    # ── Declarant / importer
    eori = _t("declarant", "eori") or _t("authorisedDeclarant", "eori") or ""
    importer_name = _t("declarant", "name") or _t("authorisedDeclarant", "name")
    if eori:
        evidence.append(_evidence("importer.eori", eori))
    if importer_name:
        evidence.append(_evidence("importer.name", importer_name))

    # ── Reporting period → use as proxy for invoice date context
    period_code = _t("reportingPeriod", "periodCode")  # e.g. "2024Q2"
    year_str = _t("reportingPeriod", "year")
    quarter_str = _t("reportingPeriod", "quarter")

    # ── Goods lines
    goods_el = root.find(_tag(ns, "goodsImported")) if ns else root.find("goodsImported")
    if goods_el is None:
        goods_el = root  # fallback: look for goodsLine at root level

    lines_data: list[dict[str, Any]] = []
    agg_direct = _ZERO
    agg_indirect = _ZERO

    line_els = goods_el.findall(_tag(ns, "goodsLine")) if ns else goods_el.findall("goodsLine")
    if not line_els and ns:
        # Try without NS in case schema omitted it
        line_els = goods_el.findall("goodsLine")

    for i, line_el in enumerate(line_els):
        def _lt(*path: str) -> str | None:
            return _find_text(line_el, ns, *path)

        cn_code = _lt("cnCode") or _lt("cn_code") or ""
        origin = _lt("countryOfOrigin") or _lt("country_of_origin") or ""
        mass_t_str = _lt("netMassTonnes") or _lt("net_mass_t") or _lt("netMass")
        mass_t = _to_decimal(mass_t_str) or _ZERO
        mass_kg = float(mass_t * _D("1000")) if mass_t else None

        emiss_el = line_el.find(_tag(ns, "embeddedEmissions")) if ns else line_el.find("embeddedEmissions")
        if emiss_el is None:
            emiss_el = line_el

        def _et(*path: str) -> str | None:
            if emiss_el is not None:
                return _find_text(emiss_el, ns, *path)
            return None

        direct_tco2e = _to_decimal(_et("directEmissions") or _et("direct_tco2e"))
        indirect_tco2e = _to_decimal(_et("indirectEmissions") or _et("indirect_tco2e"))
        see_str = _et("specificEmbeddedEmissions") or _et("see_tco2e_per_t")
        method_str = _et("calculationMethod") or _lt("calculationMethod") or "default"

        direct_kgco2e = float(direct_tco2e * _D("1000")) if direct_tco2e else None
        indirect_kgco2e = float(indirect_tco2e * _D("1000")) if indirect_tco2e else 0.0

        if direct_tco2e:
            agg_direct += direct_tco2e
        if indirect_tco2e:
            agg_indirect += indirect_tco2e

        line = {
            "cn_code": cn_code,
            "description": None,
            "quantity": mass_t and float(mass_t),
            "quantity_unit": "t",
            "net_mass_kg": mass_kg,
            "method": method_str.lower() if method_str else "default",
            "direct_embedded_kgco2e": direct_kgco2e,
            "indirect_embedded_kgco2e": indirect_kgco2e,
        }

        if cn_code:
            evidence.append(_evidence(f"lines[{i}].cn_code", cn_code))
        if mass_kg:
            evidence.append(_evidence(f"lines[{i}].net_mass_kg", mass_kg))
        if direct_kgco2e:
            evidence.append(_evidence(f"lines[{i}].direct_embedded_kgco2e", direct_kgco2e))

        lines_data.append(line)

    # ── Aggregate emissions from <embeddedEmissions> or <cbamCertificates> at root
    agg_el = root.find(_tag(ns, "embeddedEmissions")) if ns else root.find("embeddedEmissions")
    if agg_el is not None:
        root_direct = _to_decimal(_find_text(agg_el, ns, "totalDirectEmissions"))
        root_indirect = _to_decimal(_find_text(agg_el, ns, "totalIndirectEmissions"))
        if root_direct:
            agg_direct = root_direct
        if root_indirect:
            agg_indirect = root_indirect

    total_direct_kg = float(agg_direct * _D("1000"))
    total_indirect_kg = float(agg_indirect * _D("1000"))

    return {
        "importer": {
            "name": importer_name,
            "eori": eori,
        },
        "invoice": {
            "invoice_number": None,
            "invoice_date": None,
            "origin_country": None,  # per-line origin in XML
            "incoterm": None,
            "entry_reference": period_code,
        },
        "lines": lines_data,
        "emissions": {
            "method": lines_data[0]["method"] if lines_data else None,
            "direct_embedded_kgco2e": total_direct_kg,
            "indirect_embedded_kgco2e": total_indirect_kg,
        },
        "document_type": "cbam_xml_declaration",
        "reporting_year": int(year_str) if year_str and year_str.isdigit() else None,
        "reporting_quarter": int(quarter_str) if quarter_str and quarter_str.isdigit() else None,
        "evidence": evidence,
    }
