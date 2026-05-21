"""EU CBAM Registry XML Builder — consolidated service for the api/ layer.

This module is the canonical XML builder for the consolidated api/ service
and supersedes ``nucleo-ledger/ledger_app/services/cbam_xml_exporter.py``
for the permanent regime.

It produces the ``cbam:quarterlyDeclaration`` XML required for submission
to the EU CBAM Transitional Registry portal.

Namespace
---------
``urn:ec.europa.eu:taxud:cbam:declaration:v1``

Changes from the original exporter (cbam_xml_exporter.py)
----------------------------------------------------------
1. **EmissionsCalculationMethod mapping** (Annex I, CIR 2023/1773)
   Raw platform method strings are mapped to the registry vocabulary:

     actual_verified   → "ACTUAL"
     actual_unverified → "ESTIMATED"
     actual            → "ESTIMATED"  (unqualified = unverified, conservative)
     estimated         → "ESTIMATED"
     default / None    → "DEFAULT"
     <any other>       → "DEFAULT"

2. **DataSourceInformation** — a ``<cbam:dataSource>`` child element is added
   to each ``<cbam:goodsLine>`` when ``factor_table_version`` is present in the
   goods-line dict.  Maps to Annex I "Data Source Information".

3. **Third-country carbon price deduction** (Art. 9 deduction)
   A new ``carbon_price_paid_third_country_eur`` parameter is added.
   When non-zero, ``<cbam:thirdCountryCarbonPrice>`` is emitted inside
   ``<cbam:cbamCertificates>`` (EU 2023/956, Art. 9).

4. **Unit conversion guards** — net mass and embedded emissions are normalised
   to tonnes / tCO2e with explicit defensive fallbacks from kg / kgCO2e inputs.
   Keys accepted per goods-line dict are documented in ``build_quarterly_declaration``.

5. **Jurisdiction guard** — ``build_xml_for_case()`` checks the case's
   ``jurisdiction`` field (migration 009) and returns ``None`` for UK-only cases,
   preventing accidental EU submission for non-EU importers.

Regulation references
---------------------
EU Regulation 2023/956 (CBAM framework), Arts. 6, 9, 21, 22
Commission Implementing Regulation 2023/1773 (methodology + Annex VI defaults)
EC DG TAXUD — Transitional Registry Submission Guide (Dec 2023)
"""

from __future__ import annotations

import calendar
import math
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any
from xml.dom import minidom
from xml.etree import ElementTree as ET

_CBAM_NS = "urn:ec.europa.eu:taxud:cbam:declaration:v1"
_XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"

ET.register_namespace("cbam", _CBAM_NS)
ET.register_namespace("xsi", _XSI_NS)

_D = Decimal
_ZERO = _D("0")

# Jurisdictions that require EU XML output (migration 009)
_EU_JURISDICTIONS: frozenset[str] = frozenset(("EU", "BOTH"))

# ---------------------------------------------------------------------------
# EmissionsCalculationMethod mapping
# Annex I, Commission Implementing Regulation 2023/1773
# ---------------------------------------------------------------------------
_CALCULATION_METHOD_MAP: dict[str, str] = {
    "actual_verified": "ACTUAL",
    "actual_unverified": "ESTIMATED",
    # Unqualified "actual" treated conservatively as unverified/estimated until
    # a third-party verification report reference is attached.
    "actual": "ESTIMATED",
    "estimated": "ESTIMATED",
    "default": "DEFAULT",
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

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
    """Convert year + quarter to the EC period code, e.g. ``2024Q2``."""
    return f"{year}Q{quarter}"


def _quarter_start_date(year: int, quarter: int) -> str:
    month = ((quarter - 1) * 3) + 1
    return f"{year}-{month:02d}-01"


def _quarter_end_date(year: int, quarter: int) -> str:
    month = quarter * 3
    _, last_day = calendar.monthrange(year, month)
    return f"{year}-{month:02d}-{last_day:02d}"


def _map_calculation_method(raw: str | None) -> str:
    """Map a platform method string to the EU registry vocabulary.

    See ``_CALCULATION_METHOD_MAP`` for the full mapping table.
    """
    if not raw:
        return "DEFAULT"
    return _CALCULATION_METHOD_MAP.get(str(raw).lower().strip(), "DEFAULT")


def _normalise_cn8(cn_code: str) -> tuple[str, bool]:
    """Return (8-digit CN code, was_padded_from_6_digits).

    6-digit CN / HS codes are padded with "00" per TARIC convention so that
    the ``CombinedNomenclatureCode`` element always carries an 8-digit value.
    """
    cleaned = re.sub(r"\s", "", str(cn_code))
    if len(cleaned) == 6 and cleaned.isdigit():
        return cleaned + "00", True
    return cleaned, False


def _net_mass_tonnes(gl: dict[str, Any]) -> Decimal:
    """Resolve NetMass in tonnes from a goods-line dict.

    Accepted input keys (checked in order of preference):
    - ``net_mass_t`` / ``net_mass_tonnes`` — value already in tonnes
    - ``net_mass_kg``                       — value in kg, divided by 1 000
    - ``quantity`` when ``quantity_unit`` is 'kg' / 'kilogram'

    Unit conversion: kg ÷ 1 000 = tonnes (SI)
    """
    for key in ("net_mass_t", "net_mass_tonnes"):
        v = gl.get(key)
        if v is not None:
            return _to_decimal(v)
    v_kg = gl.get("net_mass_kg")
    if v_kg is not None:
        return _to_decimal(v_kg) / _D("1000")
    if str(gl.get("quantity_unit", "")).lower() in ("kg", "kilogram", "kilograms"):
        v = gl.get("quantity")
        if v is not None:
            return _to_decimal(v) / _D("1000")
    return _ZERO


def _embedded_tco2e(gl: dict[str, Any], key_tco2e: str, key_kgco2e: str) -> Decimal:
    """Resolve an embedded-emissions figure in tCO2e.

    Accepted input keys:
    - ``key_tco2e``   — value already in tCO2e   ← preferred
    - ``key_kgco2e``  — value in kgCO2e, divided by 1 000

    Unit conversion: kgCO2e ÷ 1 000 = tCO2e
    """
    v_t = gl.get(key_tco2e)
    if v_t is not None:
        return _to_decimal(v_t)
    v_kg = gl.get(key_kgco2e)
    if v_kg is not None:
        return _to_decimal(v_kg) / _D("1000")
    return _ZERO


# ---------------------------------------------------------------------------
# Main export function
# ---------------------------------------------------------------------------

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
    carbon_price_paid_third_country_eur: Decimal | None = None,
    eu_ets_price_eur: Decimal | None = None,
    generated_at: str | None = None,
) -> str:
    """Build the quarterly CBAM declaration XML string.

    Parameters
    ----------
    importer_eori:
        EU EORI of the authorised CBAM declarant.
        Emitted as ``<cbam:declarant><cbam:eori>`` (ImporterEORINumber, Annex I).
    importer_name:
        Legal name of the declarant.  Optional but recommended.
    reporting_year:
        Calendar year of the reporting period.
    reporting_quarter:
        Quarter (1–4) of the reporting period.
    goods_lines:
        List of goods-line dicts.  Keys accepted per line:

        Mandatory
        ~~~~~~~~~
        - ``cn_code``           6- or 8-digit CN/TARIC code (CombinedNomenclatureCode).
                                6-digit codes are padded to 8 digits with "00".
        - ``country_of_origin`` ISO 3166-1 alpha-2 (alias: ``origin_country``).

        NetMass (one of — in tonnes after conversion):
        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        - ``net_mass_t``        NetMass already in tonnes               ← preferred
        - ``net_mass_kg``       NetMass in kg → auto-divided by 1 000
        - ``quantity``          when ``quantity_unit`` is "kg"

        DirectEmbeddedEmissions / IndirectEmbeddedEmissions (in tCO2e):
        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        - ``direct_tco2e``             DirectEmbeddedEmissions (tCO2e)   ← preferred
        - ``direct_embedded_kgco2e``   DirectEmbeddedEmissions (kgCO2e)  → ÷ 1 000
        - ``indirect_tco2e``           IndirectEmbeddedEmissions (tCO2e)  ← preferred
        - ``indirect_embedded_kgco2e`` IndirectEmbeddedEmissions (kgCO2e) → ÷ 1 000
        - ``see_tco2e_per_t``          SpecificEmbeddedEmissions (tCO2e/t)

        EmissionsCalculationMethod (mapped to registry vocabulary):
        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        - ``calculation_method`` or ``method``
          Accepted → XML value:
            "actual_verified"   → "ACTUAL"
            "actual_unverified" → "ESTIMATED"
            "actual"            → "ESTIMATED"  (unqualified = unverified)
            "estimated"         → "ESTIMATED"
            "default" / None    → "DEFAULT"

        DataSourceInformation:
        ~~~~~~~~~~~~~~~~~~~~~~
        - ``factor_table_version``  Version of the emission factor table used
                                    (e.g. "Annex_VI_2023-1773_v2").
                                    Emitted as ``<cbam:dataSource><cbam:factorTableVersion>``.

        Optional
        ~~~~~~~~
        - ``verification_reference``  Third-party verification report reference.
        - ``production_route``        Production route identifier (e.g. "BF_BOF").
        - ``installation_id``         Installation operator ID from EU registry.

    total_embedded_tco2e:
        Pre-computed total from QuarterlyReconciliationResult.  Summed from
        goods_lines when None.
    net_liability_tco2e:
        Net CBAM liability after Art. 9 deduction.
    cbam_certificates_required:
        Number of certificates to surrender (ceil of net_liability).
    carbon_price_deduction_tco2e:
        Art. 9 deduction amount in tCO2e (from recognised-scheme calculation).
    carbon_price_paid_third_country_eur:
        Per-tonne carbon price (EUR/tCO2e) already paid in the origin country
        under an EU-recognised third-country scheme (EU 2023/956, Art. 9).
        Emitted as ``<cbam:thirdCountryCarbonPrice><cbam:priceEurPerTonne>``.
        The registry uses this to compute the actual certificate reduction.
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
            f"{{{_XSI_NS}}}schemaLocation": f"{_CBAM_NS} cbam-declaration-v1.xsd",
            "version": "1.0",
            "generatedAt": ts,
        },
    )

    # ── Declarant — ImporterEORINumber (Annex I field)
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

        # CombinedNomenclatureCode — always 8-digit (6-digit padded with "00")
        raw_cn = str(gl.get("cn_code") or "")
        cn8, was_padded = _normalise_cn8(raw_cn)
        cn_el = _sub(line_el, "cnCode", cn8)
        if was_padded:
            # Flag so downstream validators can request human confirmation of
            # the full 8-digit code before registry submission.
            cn_el.attrib["paddedFrom6Digit"] = "true"

        origin = str(gl.get("country_of_origin") or gl.get("origin_country") or "")
        _sub(line_el, "countryOfOrigin", origin)

        # NetMass — must be in tonnes (Annex I; NOT kg)
        mass_t = _net_mass_tonnes(gl)
        _sub(line_el, "netMassTonnes", _fmt(mass_t, 3))

        # DirectEmbeddedEmissions / IndirectEmbeddedEmissions — in tCO2e
        direct = _embedded_tco2e(gl, "direct_tco2e", "direct_embedded_kgco2e")
        indirect = _embedded_tco2e(gl, "indirect_tco2e", "indirect_embedded_kgco2e")
        see = _to_decimal(gl.get("see_tco2e_per_t"))

        # EmissionsCalculationMethod — mapped to registry vocabulary
        raw_method = gl.get("calculation_method") or gl.get("method")
        mapped_method = _map_calculation_method(raw_method)

        emissions_el = _sub(line_el, "embeddedEmissions")
        _sub(emissions_el, "directEmissions", _fmt(direct, 6))
        _sub(emissions_el, "indirectEmissions", _fmt(indirect, 6))
        _sub(emissions_el, "totalEmbedded", _fmt(direct + indirect, 6))
        _sub(emissions_el, "specificEmbeddedEmissions", _fmt(see, 6))
        _sub(emissions_el, "calculationMethod", mapped_method)

        # DataSourceInformation — factorTableVersion (CIR 2023/1773, Annex I)
        factor_ver = gl.get("factor_table_version")
        if factor_ver:
            ds_el = _sub(line_el, "dataSource")
            _sub(ds_el, "factorTableVersion", str(factor_ver))

        vref = gl.get("verification_reference")
        if vref:
            _sub(line_el, "verificationReference", str(vref))

        route = gl.get("production_route")
        if route:
            _sub(line_el, "productionRoute", str(route))

        installation = gl.get("installation_id")
        if installation:
            _sub(line_el, "installationId", str(installation))

        total_direct += direct
        total_indirect += indirect
        total_mass += mass_t

    # ── Aggregated embedded emissions
    agg_el = _sub(root, "embeddedEmissions")
    computed_total = total_direct + total_indirect
    reported_total = (
        _to_decimal(total_embedded_tco2e)
        if total_embedded_tco2e is not None
        else computed_total
    )
    _sub(agg_el, "totalDirectEmissions", _fmt(total_direct, 6))
    _sub(agg_el, "totalIndirectEmissions", _fmt(total_indirect, 6))
    _sub(agg_el, "totalEmbeddedEmissions", _fmt(reported_total, 6))
    _sub(agg_el, "totalNetMassTonnes", _fmt(total_mass, 3))

    # ── CBAM certificates
    certs_el = _sub(root, "cbamCertificates")
    net_liab = (
        _to_decimal(net_liability_tco2e)
        if net_liability_tco2e is not None
        else reported_total
    )
    deduction = (
        _to_decimal(carbon_price_deduction_tco2e)
        if carbon_price_deduction_tco2e is not None
        else _ZERO
    )
    certs = (
        cbam_certificates_required
        if cbam_certificates_required is not None
        else math.ceil(float(net_liab))
    )

    _sub(certs_el, "grossLiabilityTco2e", _fmt(reported_total, 6))
    _sub(certs_el, "art9DeductionTco2e", _fmt(deduction, 6))
    _sub(certs_el, "netLiabilityTco2e", _fmt(net_liab, 6))
    _sub(certs_el, "certificatesRequired", str(certs))

    if eu_ets_price_eur is not None:
        _sub(certs_el, "euEtsPriceEur", _fmt(_to_decimal(eu_ets_price_eur), 2))

    # Art. 9 — third-country carbon price (EU 2023/956, Art. 9)
    # The registry uses this declared per-tonne price to reduce certificate
    # surrender proportionally (reduction = embedded_tco2e × price / EUA_price).
    cpptce = _to_decimal(carbon_price_paid_third_country_eur)
    if cpptce > _ZERO:
        tcp_el = _sub(certs_el, "thirdCountryCarbonPrice")
        _sub(tcp_el, "priceEurPerTonne", _fmt(cpptce, 2))

    # ── Regulatory references (informational)
    refs_el = _sub(root, "regulatoryReferences")
    _sub(refs_el, "ref", "EU Regulation 2023/956 (CBAM framework)")
    _sub(refs_el, "ref", "Commission Implementing Regulation 2023/1773 (methodology)")

    return _pretty_xml(root)


def _pretty_xml(root: ET.Element) -> str:
    """Return an indented UTF-8 XML string with a proper declaration header."""
    raw = ET.tostring(root, encoding="unicode", xml_declaration=False)
    dom = minidom.parseString(f'<?xml version="1.0" encoding="UTF-8"?>{raw}')
    pretty = dom.toprettyxml(indent="  ", encoding=None)
    lines = pretty.split("\n")
    if lines[0].startswith("<?xml"):
        lines[0] = '<?xml version="1.0" encoding="UTF-8"?>'
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Structural validator
# ---------------------------------------------------------------------------

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

    expected_root = _tag("quarterlyDeclaration")
    if root.tag != expected_root:
        errors.append(
            f"Root element must be <cbam:quarterlyDeclaration>, got <{root.tag}>"
        )

    for path in _REQUIRED_ELEMENTS:
        parts = path.split("/")
        current = root
        found = True
        for part in parts:
            child = current.find(_tag(part))
            if child is None:
                errors.append(
                    f"Missing required element: <cbam:{part}> (path: {path})"
                )
                found = False
                break
            current = child
        if found and len(current) == 0 and (current.text is None or not current.text.strip()):
            errors.append(
                f"Empty required element: <cbam:{parts[-1]}> (path: {path})"
            )

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


# ---------------------------------------------------------------------------
# Convenience: build from QuarterlyReconciliationResult
# ---------------------------------------------------------------------------

def declaration_from_reconciliation(
    reconciliation: Any,
    goods_lines: list[dict[str, Any]],
    importer_name: str | None = None,
    carbon_price_paid_third_country_eur: Decimal | None = None,
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
    carbon_price_paid_third_country_eur:
        Per-tonne carbon price paid in origin country (EUR/tCO2e), Art. 9.
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
        carbon_price_paid_third_country_eur=carbon_price_paid_third_country_eur,
        eu_ets_price_eur=reconciliation.eu_ets_price_eur,
    )


# ---------------------------------------------------------------------------
# Jurisdiction guard — use this instead of build_quarterly_declaration
# when constructing output from a persisted cbam_cases row.
# ---------------------------------------------------------------------------

def build_xml_for_case(
    case: dict[str, Any],
    goods_lines: list[dict[str, Any]],
    **kwargs: Any,
) -> str | None:
    """Build EU XML for a case, respecting its ``jurisdiction`` field.

    Returns the XML string for EU or BOTH cases.
    Returns ``None`` for UK-only cases — the caller must check before
    attempting EU registry submission.

    Parameters
    ----------
    case:
        Case record dict containing at minimum ``importer_eori``,
        ``reporting_year``, ``reporting_quarter``.  Optional keys:
        - ``jurisdiction``                       default "EU"
        - ``importer_name``
        - ``carbon_price_paid_third_country_eur``  Art. 9 deduction price
    goods_lines:
        Goods-line dicts (see ``build_quarterly_declaration``).
    **kwargs:
        Additional keyword arguments forwarded to ``build_quarterly_declaration``
        (e.g. ``total_embedded_tco2e``, ``eu_ets_price_eur``).
    """
    jurisdiction = str(case.get("jurisdiction") or "EU").upper()
    if jurisdiction not in _EU_JURISDICTIONS:
        return None

    cpptce_raw = case.get("carbon_price_paid_third_country_eur")
    cpptce = _to_decimal(cpptce_raw) if cpptce_raw is not None else None

    return build_quarterly_declaration(
        importer_eori=str(case["importer_eori"]),
        importer_name=case.get("importer_name"),
        reporting_year=int(case["reporting_year"]),
        reporting_quarter=int(case["reporting_quarter"]),
        goods_lines=goods_lines,
        carbon_price_paid_third_country_eur=cpptce,
        **kwargs,
    )
