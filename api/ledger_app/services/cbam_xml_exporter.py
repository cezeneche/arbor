"""CBAM EU Registry XML Exporter — quarterly declaration format.

Generates the ``cbam:quarterlyDeclaration`` XML document required for
submission to the EU CBAM Transitional Registry portal.

The namespace and element structure follows the schema published by EC DG TAXUD
for the transitional period (1 Oct 2023 – 31 Dec 2025) and the permanent regime
from 1 Jan 2026.

Namespace
---------
``urn:ec.europa.eu:taxud:cbam:declaration:v1``

Key elements produced
---------------------
- <cbam:quarterlyDeclaration>
    - <cbam:declarant>          importer EORI + name
    - <cbam:reportingPeriod>    year / quarter
    - <cbam:goodsImported>
        - <cbam:goodsLine> × N  one per CN-code / goods line
    - <cbam:embeddedEmissions>  aggregated totals
    - <cbam:cbamCertificates>   certificate requirement + Art. 9 deduction

Regulation references
---------------------
EU Regulation 2023/956 (CBAM framework), Arts. 6, 9, 21, 22
Commission Implementing Regulation 2023/1773 (methodology + Annex VI defaults)
EC DG TAXUD — Transitional Registry Submission Guide (Dec 2023)

Validation
----------
``validate_xml_structure`` performs a structural check (required elements +
non-empty text) without needing an external XSD file.  A full XSD validation
step can be added when the official EC XSD is available.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any
from xml.etree import ElementTree as ET
from xml.dom import minidom

_CBAM_NS = "urn:ec.europa.eu:taxud:cbam:declaration:v1"
_XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
_NS_MAP = {"cbam": _CBAM_NS, "xsi": _XSI_NS}

_D = Decimal
_ZERO = _D("0")

# Register namespace prefixes so ElementTree writes ``cbam:`` not ``ns0:``.
ET.register_namespace("cbam", _CBAM_NS)
ET.register_namespace("xsi", _XSI_NS)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _tag(name: str) -> str:
    return f"{{{_CBAM_NS}}}{name}"


def _sub(parent: ET.Element, name: str, text: str | None = None) -> ET.Element:
    el = ET.SubElement(parent, _tag(name))
    if text is not None:
        el.text = str(text)
    return el


def _to_decimal(value: Any, default: Decimal = _ZERO) -> Decimal:
    if value is None:
        return default
    try:
        return _D(str(value))
    except (InvalidOperation, TypeError):
        return default


def _fmt(value: Decimal, places: int = 6) -> str:
    """Format a Decimal to a fixed number of decimal places."""
    quantizer = _D("0." + "0" * places)
    return str(value.quantize(quantizer))


def _quarter_to_period_code(year: int, quarter: int) -> str:
    """Convert year + quarter to the EC period code format, e.g. ``2024Q2``."""
    return f"{year}Q{quarter}"


def _quarter_start_date(year: int, quarter: int) -> str:
    """Return ISO date of the first day of the reporting quarter."""
    month = ((quarter - 1) * 3) + 1
    return f"{year}-{month:02d}-01"


def _quarter_end_date(year: int, quarter: int) -> str:
    """Return ISO date of the last day of the reporting quarter."""
    month = quarter * 3
    # Last day of the month: advance to next month day-0
    import calendar
    _, last_day = calendar.monthrange(year, month)
    return f"{year}-{month:02d}-{last_day:02d}"


# ── Main export function ──────────────────────────────────────────────────────

def build_quarterly_declaration(
    *,
    importer_eori: str,
    importer_name: str | None = None,
    reporting_year: int,
    reporting_quarter: int,
    goods_lines: list[dict[str, Any]],
    total_embedded_tco2e: Decimal | None = None,
    net_liability_tco2e: Decimal | None = None,
    cbam_certificates_required: int | None = None,
    carbon_price_deduction_tco2e: Decimal | None = None,
    eu_ets_price_eur: Decimal | None = None,
    generated_at: str | None = None,
) -> str:
    """Build the quarterly CBAM declaration XML string.

    Parameters
    ----------
    importer_eori:
        EU EORI of the declarant (authorised CBAM declarant).
    importer_name:
        Legal name of the declarant.  Optional but recommended.
    reporting_year:
        Calendar year of the reporting period.
    reporting_quarter:
        Quarter (1–4) of the reporting period.
    goods_lines:
        List of goods-line dicts.  Each must contain:
          - ``cn_code``           8-digit CN code
          - ``country_of_origin`` ISO 3166-1 alpha-2
          - ``net_mass_t``        net mass in tonnes (Decimal or float)
          - ``direct_tco2e``      direct embedded emissions (tCO2e)
          - ``indirect_tco2e``    indirect embedded emissions (tCO2e, may be 0)
          - ``see_tco2e_per_t``   Specific Embedded Emissions (tCO2e/t)
          - ``calculation_method``  ``actual`` | ``default`` | ``estimated``
          - ``production_route``   optional route identifier
          - ``installation_id``    optional installation operator ID
    total_embedded_tco2e:
        Pre-computed total from QuarterlyReconciliationResult.  When None, it is
        summed from goods_lines.
    net_liability_tco2e:
        Net CBAM liability after Art. 9 deduction.
    cbam_certificates_required:
        Number of certificates to surrender (ceil of net_liability).
    carbon_price_deduction_tco2e:
        Art. 9 deduction amount.
    eu_ets_price_eur:
        EUA price used for financial valuation (informational only).
    generated_at:
        ISO 8601 timestamp string.  Defaults to current UTC time.

    Returns
    -------
    Pretty-printed UTF-8 XML string.
    """
    ts = generated_at or datetime.now(timezone.utc).isoformat()

    # ── Root element
    root = ET.Element(
        _tag("quarterlyDeclaration"),
        attrib={
            f"{{{_XSI_NS}}}schemaLocation": (
                f"{_CBAM_NS} cbam-declaration-v1.xsd"
            ),
            "version": "1.0",
            "generatedAt": ts,
        },
    )

    # ── Declarant
    declarant = _sub(root, "declarant")
    _sub(declarant, "eori", importer_eori)
    if importer_name:
        _sub(declarant, "name", importer_name)

    # ── Reporting period
    period = _sub(root, "reportingPeriod")
    _sub(period, "periodCode", _quarter_to_period_code(reporting_year, reporting_quarter))
    _sub(period, "year", str(reporting_year))
    _sub(period, "quarter", str(reporting_quarter))
    _sub(period, "startDate", _quarter_start_date(reporting_year, reporting_quarter))
    _sub(period, "endDate", _quarter_end_date(reporting_year, reporting_quarter))

    # ── Goods imported
    goods_el = _sub(root, "goodsImported")
    total_direct = _ZERO
    total_indirect = _ZERO
    total_mass = _ZERO

    for idx, gl in enumerate(goods_lines, start=1):
        line_el = _sub(goods_el, "goodsLine")
        line_el.attrib["lineNumber"] = str(idx)

        cn = str(gl.get("cn_code") or "")
        origin = str(gl.get("country_of_origin") or gl.get("origin_country") or "")
        mass_t = _to_decimal(gl.get("net_mass_t") or (
            _to_decimal(gl.get("net_mass_kg")) / _D("1000")
            if gl.get("net_mass_kg") else _ZERO
        ))
        direct = _to_decimal(gl.get("direct_tco2e") or (
            _to_decimal(gl.get("direct_kgco2e")) / _D("1000")
            if gl.get("direct_kgco2e") else _ZERO
        ))
        indirect = _to_decimal(gl.get("indirect_tco2e") or (
            _to_decimal(gl.get("indirect_kgco2e")) / _D("1000")
            if gl.get("indirect_kgco2e") else _ZERO
        ))
        see = _to_decimal(gl.get("see_tco2e_per_t"))
        method = str(gl.get("calculation_method") or "default")
        route = gl.get("production_route")
        installation = gl.get("installation_id")

        _sub(line_el, "cnCode", cn)
        _sub(line_el, "countryOfOrigin", origin)
        _sub(line_el, "netMassTonnes", _fmt(mass_t, 3))

        emissions_el = _sub(line_el, "embeddedEmissions")
        _sub(emissions_el, "directEmissions", _fmt(direct, 6))
        _sub(emissions_el, "indirectEmissions", _fmt(indirect, 6))
        _sub(emissions_el, "totalEmbedded", _fmt(direct + indirect, 6))
        _sub(emissions_el, "specificEmbeddedEmissions", _fmt(see, 6))
        _sub(emissions_el, "calculationMethod", method)

        if route:
            _sub(line_el, "productionRoute", str(route))
        if installation:
            _sub(line_el, "installationId", str(installation))

        total_direct += direct
        total_indirect += indirect
        total_mass += mass_t

    # ── Aggregated embedded emissions
    agg_el = _sub(root, "embeddedEmissions")
    computed_total = total_direct + total_indirect
    reported_total = _to_decimal(total_embedded_tco2e) if total_embedded_tco2e is not None else computed_total
    _sub(agg_el, "totalDirectEmissions", _fmt(total_direct, 6))
    _sub(agg_el, "totalIndirectEmissions", _fmt(total_indirect, 6))
    _sub(agg_el, "totalEmbeddedEmissions", _fmt(reported_total, 6))
    _sub(agg_el, "totalNetMassTonnes", _fmt(total_mass, 3))

    # ── CBAM certificates
    certs_el = _sub(root, "cbamCertificates")
    net_liab = _to_decimal(net_liability_tco2e) if net_liability_tco2e is not None else reported_total
    deduction = _to_decimal(carbon_price_deduction_tco2e) if carbon_price_deduction_tco2e is not None else _ZERO
    certs = cbam_certificates_required if cbam_certificates_required is not None else int(
        # ceil
        float(net_liab) + (0 if float(net_liab) == int(float(net_liab)) else 0)
    )
    import math
    certs = cbam_certificates_required if cbam_certificates_required is not None else math.ceil(float(net_liab))

    _sub(certs_el, "grossLiabilityTco2e", _fmt(reported_total, 6))
    _sub(certs_el, "art9DeductionTco2e", _fmt(deduction, 6))
    _sub(certs_el, "netLiabilityTco2e", _fmt(net_liab, 6))
    _sub(certs_el, "certificatesRequired", str(certs))
    if eu_ets_price_eur is not None:
        _sub(certs_el, "euEtsPriceEur", _fmt(_to_decimal(eu_ets_price_eur), 2))

    # ── Regulatory references (informational)
    refs_el = _sub(root, "regulatoryReferences")
    _sub(refs_el, "ref", "EU Regulation 2023/956 (CBAM framework)")
    _sub(refs_el, "ref", "Commission Implementing Regulation 2023/1773 (methodology)")

    return _pretty_xml(root)


def _pretty_xml(root: ET.Element) -> str:
    """Return an indented, UTF-8 encoded XML string."""
    raw = ET.tostring(root, encoding="unicode", xml_declaration=False)
    dom = minidom.parseString(f'<?xml version="1.0" encoding="UTF-8"?>{raw}')
    pretty = dom.toprettyxml(indent="  ", encoding=None)
    # minidom adds its own xml declaration — strip the duplicate if any
    lines = pretty.split("\n")
    if lines[0].startswith("<?xml"):
        lines[0] = '<?xml version="1.0" encoding="UTF-8"?>'
    return "\n".join(lines)


# ── Structural validator ──────────────────────────────────────────────────────

_REQUIRED_ELEMENTS = [
    "declarant",
    "declarant/eori",
    "reportingPeriod",
    "reportingPeriod/periodCode",
    "reportingPeriod/year",
    "reportingPeriod/quarter",
    "goodsImported",
    "embeddedEmissions",
    "embeddedEmissions/totalEmbeddedEmissions",
    "cbamCertificates",
    "cbamCertificates/certificatesRequired",
]


def validate_xml_structure(xml_str: str) -> list[str]:
    """Validate the XML string against required structural elements.

    Returns a list of error strings (empty list = valid).

    This is a lightweight structural check.  A full XSD validation step
    requires the official EC XSD file and the ``lxml`` library.
    """
    errors: list[str] = []

    try:
        root = ET.fromstring(xml_str.encode() if isinstance(xml_str, str) else xml_str)
    except ET.ParseError as exc:
        return [f"XML parse error: {exc}"]

    # Check root tag
    expected_root = _tag("quarterlyDeclaration")
    if root.tag != expected_root:
        errors.append(f"Root element must be <cbam:quarterlyDeclaration>, got <{root.tag}>")

    # Check required elements; for leaf elements also check non-empty text
    for path in _REQUIRED_ELEMENTS:
        parts = path.split("/")
        current = root
        found = True
        for part in parts:
            child = current.find(_tag(part))
            if child is None:
                errors.append(f"Missing required element: <cbam:{part}> (path: {path})")
                found = False
                break
            current = child
        # Only require non-empty text on leaf elements (no child elements)
        if found and len(current) == 0 and (current.text is None or not current.text.strip()):
            errors.append(f"Empty required element: <cbam:{parts[-1]}> (path: {path})")

    # Check at least one goodsLine
    goods_el = root.find(_tag("goodsImported"))
    if goods_el is not None:
        lines = goods_el.findall(_tag("goodsLine"))
        if not lines:
            errors.append("goodsImported must contain at least one <cbam:goodsLine>")
        else:
            for i, line in enumerate(lines):
                for required_child in ("cnCode", "countryOfOrigin", "netMassTonnes"):
                    child = line.find(_tag(required_child))
                    if child is None or not (child.text or "").strip():
                        errors.append(
                            f"goodsLine[{i+1}] missing or empty <cbam:{required_child}>"
                        )

    return errors


# ── Convenience: build from QuarterlyReconciliationResult ─────────────────────

def declaration_from_reconciliation(
    reconciliation: Any,  # QuarterlyReconciliationResult
    goods_lines: list[dict[str, Any]],
    importer_name: str | None = None,
) -> str:
    """Build XML from a QuarterlyReconciliationResult dataclass.

    Parameters
    ----------
    reconciliation:
        The result of ``reconcile_quarter()``.
    goods_lines:
        Flat list of goods-line dicts (all cases, all shipments).
    importer_name:
        Optional declarant legal name.

    Returns
    -------
    UTF-8 XML string.
    """
    return build_quarterly_declaration(
        importer_eori=reconciliation.importer_eori,
        importer_name=importer_name,
        reporting_year=reconciliation.reporting_year,
        reporting_quarter=reconciliation.reporting_quarter,
        goods_lines=goods_lines,
        total_embedded_tco2e=reconciliation.total_embedded_tco2e,
        net_liability_tco2e=reconciliation.net_liability_tco2e,
        cbam_certificates_required=reconciliation.cbam_certificates_required,
        carbon_price_deduction_tco2e=reconciliation.total_carbon_price_deduction_tco2e,
        eu_ets_price_eur=reconciliation.eu_ets_price_eur,
    )
