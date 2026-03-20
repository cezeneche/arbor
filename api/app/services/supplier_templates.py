"""Supplier emissions data request template generator — UK/EU CBAM.

PROBLEM ADDRESSED
-----------------
The biggest compliance barrier is obtaining actual embedded-emissions data from
overseas suppliers.  Most suppliers have never heard of CBAM and do not know:
  (a) what data to provide,
  (b) in what unit and format, or
  (c) that the data may be independently verified.

This module generates per-goods-line, jurisdiction-aware data-request letters
that an importer can send directly to the installation operator.  Each letter:
  • Names the exact CN code and product
  • Lists every required data field with units and regulatory references
  • Explains what CBAM is and why the supplier must provide the data
  • Notes the verification requirement (GACI-accredited verifier, ISO 14064-3)
  • Flags where translation into the supplier's language is advisable

PUBLIC API
----------
GoodsLineContext     dataclass — input gathered from DB
SupplierRequest      dataclass — generated request (email text + metadata)

generate_supplier_request(ctx, jurisdiction, supplier_contact_name) → SupplierRequest
render_pdf_letter(request)                                           → bytes
generate_batch_zip(requests, include_pdf)                            → bytes

REGULATORY BASIS
----------------
EU 2023/1773, Annex IV  — calculation methodology (embedded emissions)
EU 2023/1773, Annex VI  — default SEE values per CN code
EU 2023/956             — scope (which goods / sectors)
Finance (No.2) Bill 2025-26 — UK CBAM framework
ISO 14064-3             — GHG verification standard
ISO 17029 / 14065 / 14066 — verifier accreditation standards
"""

from __future__ import annotations

import io
import re
import textwrap
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any


# ── Country helpers ─────────────────────────────────────────────────────────────

# Countries where a translation cover note is recommended (value = language)
_TRANSLATION_HINTS: dict[str, str] = {
    "CN": "Chinese (Simplified)",
    "TW": "Chinese (Traditional)",
    "HK": "Chinese (Traditional)",
    "DE": "German",
    "AT": "German",
    "CH": "German, French or Italian",
    "FR": "French",
    "BE": "French or Dutch",
    "NL": "Dutch",
    "LU": "French, German or Luxembourgish",
    "IT": "Italian",
    "ES": "Spanish",
    "PT": "Portuguese",
    "BR": "Portuguese (Brazilian)",
    "TR": "Turkish",
    "KR": "Korean",
    "JP": "Japanese",
    "RU": "Russian",
    "UA": "Ukrainian",
    "PL": "Polish",
    "CZ": "Czech",
    "SK": "Slovak",
    "RO": "Romanian",
    "HU": "Hungarian",
    "BG": "Bulgarian",
    "HR": "Croatian",
    "SI": "Slovenian",
    "GR": "Greek",
    "EG": "Arabic",
    "SA": "Arabic",
    "AE": "Arabic",
    "ID": "Indonesian",
    "VN": "Vietnamese",
    "TH": "Thai",
    "MX": "Spanish",
    "AR": "Spanish",
    "CL": "Spanish",
    "CO": "Spanish",
    "SE": "Swedish",
    "NO": "Norwegian",
    "DK": "Danish",
    "FI": "Finnish",
}

# Countries where English is the common B2B language — no translation note
_ENGLISH_B2B: frozenset[str] = frozenset({
    "GB", "IE", "US", "CA", "AU", "NZ", "ZA", "IN", "SG", "MY",
    "NG", "GH", "KE", "PH",
})

_COUNTRY_NAMES: dict[str, str] = {
    "CN": "China", "IN": "India", "TR": "Turkey", "DE": "Germany",
    "FR": "France", "IT": "Italy", "ES": "Spain", "PL": "Poland",
    "KR": "South Korea", "JP": "Japan", "US": "United States",
    "TW": "Taiwan", "BR": "Brazil", "BE": "Belgium", "NL": "Netherlands",
    "AT": "Austria", "SE": "Sweden", "NO": "Norway", "CH": "Switzerland",
    "ZA": "South Africa", "EG": "Egypt", "UA": "Ukraine", "RU": "Russia",
    "GB": "United Kingdom", "AU": "Australia", "CA": "Canada",
}


def _country_name(iso2: str | None) -> str:
    if not iso2:
        return "the country of origin"
    return _COUNTRY_NAMES.get(iso2.upper(), iso2.upper())


# ── Sector-specific data requirements ──────────────────────────────────────────

# (field_id, display_label, unit, description)
_COMMON_FIELDS: list[tuple[str, str, str, str]] = [
    (
        "specific_direct_embedded_emissions",
        "Specific direct embedded emissions",
        "tCO₂e per tonne of product",
        "Direct greenhouse gas emissions arising from the production process at the "
        "installation (scope 1), per tonne of goods produced.  Calculated per "
        "EU 2023/1773 Annex IV, Section 2.",
    ),
    (
        "reporting_period",
        "Reporting period",
        "calendar year",
        "The calendar year to which the reported emissions data refers "
        "(e.g. 1 January – 31 December 2026).",
    ),
    (
        "annual_production_volume",
        "Total production volume",
        "metric tonnes",
        "Total output of the CBAM goods in question at the installation "
        "during the reporting year.",
    ),
    (
        "installation_details",
        "Installation details",
        "text",
        "Full name of the installation, street address, city, country.  "
        "Name and contact details of the installation operator responsible for "
        "CBAM reporting.",
    ),
    (
        "national_permit_reference",
        "National environmental or operating permit reference",
        "text",
        "Reference number of the greenhouse gas emission permit or operating "
        "permit for the installation (required under EU 2023/1773 Annex IV).",
    ),
]

_INDIRECT_ELECTRICITY_FIELD: tuple[str, str, str, str] = (
    "specific_indirect_embedded_emissions",
    "Specific indirect embedded emissions (electricity)",
    "tCO₂e per tonne of product",
    "Indirect CO₂e emissions arising from the generation of electricity "
    "purchased and consumed in the production process, per tonne of goods "
    "produced.  Use location-based grid emission factor per EU 2023/1773 "
    "Annex IV, Section 3.",
)

_SECTOR_EXTRA_FIELDS: dict[str, list[tuple[str, str, str, str]]] = {
    "iron_steel": [
        (
            "production_route",
            "Production route",
            "code",
            "Blast furnace / basic oxygen furnace (BF-BOF), "
            "electric arc furnace (EAF), or direct-reduced iron + EAF (DRI-EAF).  "
            "Route determines the applicable Annex IV methodology.",
        ),
        (
            "heat_or_cast_reference",
            "Heat / cast reference",
            "text (optional)",
            "Heat number or cast reference number for traceability, "
            "if available from mill certificates.",
        ),
    ],
    "cement": [
        _INDIRECT_ELECTRICITY_FIELD,
        (
            "clinker_to_cement_ratio",
            "Clinker-to-cement ratio",
            "kg clinker per kg cement (0 – 1)",
            "Weight of clinker per tonne of cement produced.  "
            "Used to allocate calcination emissions in Annex IV Section 2.3.",
        ),
        (
            "electricity_consumption",
            "Electricity consumption",
            "MWh per tonne of product",
            "Grid electricity consumed in cement grinding per tonne of product.",
        ),
    ],
    "aluminium": [
        _INDIRECT_ELECTRICITY_FIELD,
        (
            "production_route",
            "Production route",
            "code",
            "Primary (Hall–Héroult electrolysis from alumina) or "
            "Secondary (remelting of scrap aluminium).  "
            "Primary and secondary carry significantly different default SEE values.",
        ),
        (
            "electricity_consumption",
            "Electricity consumption",
            "MWh per tonne of product",
            "Total electricity consumed per tonne of aluminium produced, "
            "including electrolysis and casting.",
        ),
        (
            "anode_effect_emissions",
            "Anode effect (PFC) emissions — primary only",
            "tCO₂e per tonne of aluminium",
            "Perfluorocarbon (PFC) emissions arising from anode effects "
            "during electrolysis.  Report separately per Annex IV Section 2.5.",
        ),
    ],
    "fertilisers": [
        _INDIRECT_ELECTRICITY_FIELD,
        (
            "n2o_emission_factor",
            "N₂O emission factor",
            "kg N₂O per tonne of nitric acid (if applicable)",
            "Nitrous oxide emissions from the Ostwald process at nitric acid "
            "plants (CN 2808).  Required per Annex IV Section 2.7.",
        ),
        (
            "n2o_abatement_factor",
            "N₂O abatement fraction",
            "percentage (%) destroyed by catalytic reduction",
            "Fraction of N₂O destroyed by installed DeNOx / NSCR catalytic "
            "abatement technology.  Set to 0 if no abatement system is installed.",
        ),
    ],
    "electricity": [
        (
            "grid_emission_factor",
            "Grid emission factor",
            "tCO₂e per MWh",
            "Country-average or network-specific grid emission factor for the "
            "electricity generated.  Reference: EU 2023/1773 Annex VI Table D "
            "or national grid operator publication.",
        ),
        (
            "annual_generation_volume",
            "Annual generation / export volume",
            "MWh",
            "Total quantity of electricity generated and exported in the "
            "reporting year.",
        ),
        (
            "fuel_mix",
            "Fuel mix / generation source breakdown",
            "% by source",
            "Percentage share of generation by fuel source: coal, gas, "
            "nuclear, hydro, wind, solar, other.",
        ),
        (
            "grid_operator_reference",
            "Transmission system operator / grid operator name",
            "text",
            "Name of the national or regional TSO whose published emission "
            "factor is used.",
        ),
    ],
    "hydrogen": [
        (
            "production_route",
            "Production route",
            "code",
            "Steam methane reforming — SMR (grey H₂), "
            "SMR + CCS (blue H₂), "
            "electrolysis from renewable electricity (green H₂), "
            "electrolysis from grid electricity, "
            "coal gasification, or other.",
        ),
        (
            "ccs_capture_fraction",
            "CCS capture fraction",
            "% of CO₂ captured (0 if no CCS)",
            "Fraction of CO₂ captured by carbon capture and storage technology "
            "at the production installation.  Required for blue hydrogen claims.",
        ),
        (
            "feedstock_type",
            "Feedstock type",
            "text",
            "Natural gas, coal, biomass, or water (electrolysis).",
        ),
        (
            "electricity_emission_factor",
            "Electricity emission factor — electrolysis only",
            "tCO₂e per MWh",
            "Emission factor for electricity used in electrolysis.  "
            "Use the grid factor per Annex VI Table D or hourly marginal "
            "factor if available.",
        ),
    ],
}

# Production route options shown in the letter per sector
_SECTOR_ROUTE_OPTIONS: dict[str, list[str]] = {
    "iron_steel": [
        "BF-BOF — Blast furnace / basic oxygen furnace (integrated route)",
        "EAF — Electric arc furnace (scrap-based route)",
        "DRI-EAF — Direct reduced iron fed into electric arc furnace",
        "Other (please describe the process in your response)",
    ],
    "cement": [
        "Dry process kiln with pre-heater and pre-calciner (most common)",
        "Dry process kiln with pre-heater (no pre-calciner)",
        "Dry process kiln (no pre-heater)",
        "Wet process kiln",
        "Other (please describe)",
    ],
    "aluminium": [
        "Primary — Hall–Héroult electrolysis (from bauxite/alumina)",
        "Secondary — remelting and refining of scrap aluminium",
        "Mixed primary and secondary (please specify the split ratio)",
    ],
    "fertilisers": [
        "Haber–Bosch process using natural gas (steam methane reforming)",
        "Haber–Bosch process using coal-derived syngas",
        "Ostwald process — nitric acid from ammonia",
        "Other (please describe)",
    ],
    "hydrogen": [
        "SMR — Steam methane reforming without CCS (grey hydrogen)",
        "SMR + CCS — Steam methane reforming with carbon capture (blue hydrogen)",
        "Electrolysis — powered by dedicated renewable electricity (green hydrogen)",
        "Electrolysis — powered by grid electricity (please provide grid emission factor)",
        "Coal or lignite gasification (brown/black hydrogen)",
        "Other (please describe)",
    ],
}

_REGULATION_REFS: dict[str, list[str]] = {
    "UK": [
        "Finance (No.2) Bill 2025-26 — UK Carbon Border Adjustment Mechanism",
        "HMRC CBAM Secondary Legislation, February 2026",
        "Commission Implementing Regulation (EU) 2023/1773, Annex IV "
        "(calculation methodology — incorporated by reference into UK CBAM rules)",
    ],
    "EU": [
        "Regulation (EU) 2023/956 — Carbon Border Adjustment Mechanism",
        "Commission Implementing Regulation (EU) 2023/1773, Annex IV "
        "(monitoring and calculation methodology)",
        "Commission Implementing Regulation (EU) 2023/1773, Annex VI "
        "(default embedded-emissions values)",
    ],
    "BOTH": [
        "Regulation (EU) 2023/956 — EU Carbon Border Adjustment Mechanism",
        "Commission Implementing Regulation (EU) 2023/1773, Annex IV and VI",
        "Finance (No.2) Bill 2025-26 — UK Carbon Border Adjustment Mechanism",
    ],
}


# ── Domain types ────────────────────────────────────────────────────────────────

@dataclass
class GoodsLineContext:
    """All data needed to generate a supplier request for one goods line.

    Assembled by the router from a DB join across cbam_goods_lines,
    cbam_shipments, cbam_cases, and (latest) cbam_emissions.
    """

    goods_line_id: str
    cn_code: str
    sector: str
    description: str | None
    installation_name: str | None
    installation_id: str | None
    origin_country: str | None
    import_date: date | None
    quantity: Decimal | None
    quantity_unit: str | None
    production_route: str | None     # from latest cbam_emissions row
    importer_name: str | None
    importer_eori: str | None
    reporting_year: int


@dataclass
class SupplierRequest:
    """Output of generate_supplier_request()."""

    goods_line_id: str
    cn_code: str
    sector: str
    origin_country: str | None
    installation_name: str | None
    importer_name: str | None
    importer_eori: str | None
    reporting_year: int
    jurisdiction: str

    # Generated content
    email_subject: str
    email_text: str                  # plain-text email body

    # Metadata
    data_fields_requested: list[str]  # field IDs
    regulation_refs: list[str]
    translation_recommended: bool
    translation_language_hint: str | None

    generated_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


# ── Email text builder ──────────────────────────────────────────────────────────

def _jurisdiction_label(jurisdiction: str) -> str:
    return {
        "UK": "UK CBAM (Carbon Border Adjustment Mechanism)",
        "EU": "EU CBAM (Carbon Border Adjustment Mechanism)",
        "BOTH": "UK and EU Carbon Border Adjustment Mechanism (CBAM)",
    }.get(jurisdiction, "CBAM")


def _data_fields_section(sector: str) -> tuple[str, list[str]]:
    """Return (formatted text block, list of field_ids) for the sector."""
    rows = list(_COMMON_FIELDS)
    rows.extend(_SECTOR_EXTRA_FIELDS.get(sector, []))

    lines: list[str] = []
    field_ids: list[str] = []
    for i, (fid, label, unit, desc) in enumerate(rows, start=1):
        field_ids.append(fid)
        lines.append(f"  {i}. {label}")
        lines.append(f"     Unit: {unit}")
        lines.append(f"     {textwrap.fill(desc, width=72, subsequent_indent='     ')}")
        lines.append("")

    return "\n".join(lines), field_ids


def _route_options_section(sector: str) -> str:
    opts = _SECTOR_ROUTE_OPTIONS.get(sector)
    if not opts:
        return ""
    lines = ["PRODUCTION ROUTE OPTIONS", "─" * 40]
    lines += [f"  • {o}" for o in opts]
    return "\n".join(lines)


def _build_email_text(
    ctx: GoodsLineContext,
    jurisdiction: str,
    supplier_contact_name: str | None,
    translation_recommended: bool,
    translation_language: str | None,
) -> tuple[str, str, list[str]]:
    """Return (subject, body, field_ids)."""

    jlabel = _jurisdiction_label(jurisdiction)
    country = _country_name(ctx.origin_country)
    product = ctx.description or f"goods classified under CN {ctx.cn_code}"
    installation = ctx.installation_name or "[Installation name — please verify]"
    salutation = (
        f"Dear {supplier_contact_name},"
        if supplier_contact_name
        else f"Dear {installation} Emissions Team,"
    )
    deadline = (date.today() + timedelta(days=30)).strftime("%-d %B %Y")
    importer = ctx.importer_name or "[Importer company name]"
    eori = ctx.importer_eori or "[EORI number]"
    year = ctx.reporting_year

    reg_refs = _REGULATION_REFS.get(jurisdiction, _REGULATION_REFS["UK"])
    data_section, field_ids = _data_fields_section(ctx.sector)
    route_section = _route_options_section(ctx.sector)

    # Sector-specific indirect note
    needs_indirect = ctx.sector in ("cement", "aluminium", "fertilisers")
    indirect_note = (
        "\nNOTE — INDIRECT EMISSIONS\n"
        "Your sector requires reporting of both direct (scope 1) and indirect\n"
        "(scope 2) embedded emissions arising from purchased electricity used\n"
        "in production.  Please report both figures separately.\n"
        if needs_indirect else ""
    )

    # Translation note
    translation_note = (
        f"\n[TRANSLATION NOTE]\n"
        f"This letter is written in English.  If your team requires it in\n"
        f"{translation_language}, please contact us and we will arrange\n"
        f"translation before the data-request deadline.\n"
        if translation_recommended and translation_language
        else ""
    )

    # Verification note
    verif_note = (
        "VERIFICATION REQUIREMENT\n"
        "─" * 40 + "\n"
        "The emissions data you provide may be subject to independent verification\n"
        "by a third-party verifier accredited by GACI (or an equivalent national\n"
        "accreditation body) operating to:\n"
        "  • ISO 17029 — Verification and validation bodies\n"
        "  • ISO 14064-3 — GHG verification\n"
        "  • ISO 14065 — Competence requirements for validation/verification bodies\n"
        "  • ISO 14066 — Competence requirements for GHG verifiers\n\n"
        "Please ensure the data you provide is accurate and is supported by\n"
        "production records that can be made available to a verifier on request.\n"
        "Importers must retain related documentation for 6 years.\n"
    )

    # Body
    body = f"""{salutation}

RE: REQUEST FOR EMBEDDED EMISSIONS DATA — {jlabel.upper()}
    CN CODE: {ctx.cn_code}  |  REPORTING YEAR: {year}
    GOODS LINE REF: {ctx.goods_line_id}

{importer} (EORI: {eori}) imports {product} (CN code: {ctx.cn_code}) from {country}.

WHAT IS CBAM?
─────────────────────────────────────────────────────────────────────────────
The {jlabel} requires importers of certain carbon-intensive goods to declare
the embedded greenhouse gas (GHG) emissions associated with those goods and
pay a carbon levy based on the embedded carbon content.

The six CBAM sectors are: cement, iron and steel, aluminium, fertilisers,
electricity, and hydrogen.  Your goods fall within the {ctx.sector.replace("_", " ").upper()} sector.

Where importers cannot provide verified actual emissions data, HMRC and the
EU CBAM Registry require the use of conservative published default values,
which typically result in a higher carbon adjustment charge than actual
emissions data would produce.  Providing accurate data therefore reduces the
compliance cost for your customer.

WHY WE NEED YOUR DATA
─────────────────────────────────────────────────────────────────────────────
To comply with {jlabel} for the {year} reporting year, we need you to provide
the specific embedded emissions data listed below for the installation at
which these goods were produced.

Regulatory basis:
{chr(10).join(f"  • {r}" for r in reg_refs)}

INSTALLATION DETAILS (PLEASE CONFIRM)
─────────────────────────────────────────────────────────────────────────────
  Installation name:     {installation}
  Installation ID/ref:   {ctx.installation_id or "[national registry ID — if known]"}
  Country of production: {country}
  Goods / product:       {product}
  CN code:               {ctx.cn_code}

DATA REQUIRED
─────────────────────────────────────────────────────────────────────────────
Please provide the following data for calendar year {year}
(1 January {year} – 31 December {year}):

{data_section}
{route_section}
{indirect_note}
{verif_note}
HOW TO RESPOND
─────────────────────────────────────────────────────────────────────────────
Please return completed data to {importer} by {deadline}.
Wherever possible, please include:
  • The methodology document or GHG inventory report from which the data
    is drawn, referenced to EU 2023/1773 Annex IV.
  • Any third-party verification report, if already obtained.

If you are unable to provide this data or need clarification on any of the
fields, please contact us as soon as possible so we can make alternative
arrangements before the CBAM return deadline.

CONFIDENTIALITY
─────────────────────────────────────────────────────────────────────────────
Emissions data you provide will be used solely for CBAM compliance purposes.
We will treat it as commercially sensitive and will not share it beyond those
parties directly involved in our CBAM return preparation and verification.
{translation_note}
Yours sincerely,

{importer}
EORI: {eori}

Generated by núcleo CBAM Compliance Platform
Goods line reference: {ctx.goods_line_id}
Generated: {date.today().strftime("%d %B %Y")}
"""

    subject = (
        f"CBAM Emissions Data Request — {product} "
        f"(CN {ctx.cn_code}) — Reporting Year {year}"
    )

    return subject, body.strip(), field_ids


# ── Main entry point ────────────────────────────────────────────────────────────

def generate_supplier_request(
    ctx: GoodsLineContext,
    jurisdiction: str = "UK",
    supplier_contact_name: str | None = None,
) -> SupplierRequest:
    """Generate a pre-populated emissions data request for the installation
    operator who produced the goods on this goods line.

    Parameters
    ----------
    ctx:
        GoodsLineContext assembled by the router from the DB.
    jurisdiction:
        "UK", "EU", or "BOTH" — controls regulatory references and framing.
    supplier_contact_name:
        If provided, used in the letter salutation.

    Returns
    -------
    SupplierRequest with `email_text` populated.  Call render_pdf_letter()
    to convert to PDF bytes.
    """
    jurisdiction = (jurisdiction or "UK").upper()
    if jurisdiction not in ("UK", "EU", "BOTH"):
        jurisdiction = "UK"

    # Translation recommendation
    cc = (ctx.origin_country or "").upper()
    translation_recommended = cc not in _ENGLISH_B2B and cc != ""
    translation_language = _TRANSLATION_HINTS.get(cc)
    if cc not in _ENGLISH_B2B and translation_language is None and cc:
        # Unknown country — recommend translation generically
        translation_recommended = True
        translation_language = "the local language"

    subject, body, field_ids = _build_email_text(
        ctx=ctx,
        jurisdiction=jurisdiction,
        supplier_contact_name=supplier_contact_name,
        translation_recommended=translation_recommended,
        translation_language=translation_language,
    )

    return SupplierRequest(
        goods_line_id=ctx.goods_line_id,
        cn_code=ctx.cn_code,
        sector=ctx.sector,
        origin_country=ctx.origin_country,
        installation_name=ctx.installation_name,
        importer_name=ctx.importer_name,
        importer_eori=ctx.importer_eori,
        reporting_year=ctx.reporting_year,
        jurisdiction=jurisdiction,
        email_subject=subject,
        email_text=body,
        data_fields_requested=field_ids,
        regulation_refs=_REGULATION_REFS.get(jurisdiction, _REGULATION_REFS["UK"]),
        translation_recommended=translation_recommended,
        translation_language_hint=translation_language,
    )


# ── PDF letter ──────────────────────────────────────────────────────────────────

# Colour palette — professional neutral
_PDF_TEAL   = "#0d9488"
_PDF_NAVY   = "#0F172A"
_PDF_GREY   = "#64748b"
_PDF_LGREY  = "#f1f5f9"
_PDF_BLACK  = "#1e293b"


def render_pdf_letter(req: SupplierRequest) -> bytes:
    """Render a SupplierRequest as a formal PDF letter using reportlab.

    Layout
    ------
    1. Letterhead  — importer details (from) + date (right-aligned)
    2. Recipient   — installation name + country
    3. Subject     — bold reference block
    4. Introduction paragraphs
    5. Data-required table  (field | unit | description)
    6. Production-route options
    7. Verification requirement
    8. Translation note (if applicable)
    9. Sign-off
    Footer on every page: goods-line reference + page number
    """
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.platypus import (
            HRFlowable, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
            Table, TableStyle,
        )
    except ImportError as exc:
        raise RuntimeError(
            "reportlab is required for PDF output — pip install reportlab"
        ) from exc

    buf = io.BytesIO()
    page_w, _ = A4
    gl_ref = req.goods_line_id[:16] + "…"
    gen_date = req.generated_at.strftime("%Y-%m-%dT%H:%M:%SZ")

    # Footer
    def _on_page(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 6)
        canvas.setFillColor(colors.HexColor(_PDF_GREY))
        footer = (
            f"Goods line: {req.goods_line_id}  |  "
            f"Generated: {gen_date}  |  Page {doc.page}  |  "
            "CONFIDENTIAL — For CBAM compliance use only"
        )
        canvas.drawCentredString(page_w / 2, 0.8 * cm, footer)
        canvas.setStrokeColor(colors.HexColor(_PDF_TEAL))
        canvas.setLineWidth(1)
        canvas.line(2 * cm, 1.1 * cm, page_w - 2 * cm, 1.1 * cm)
        canvas.restoreState()

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=2.5 * cm, rightMargin=2.5 * cm,
        topMargin=2.5 * cm, bottomMargin=2.5 * cm,
        title=req.email_subject,
        author=req.importer_name or "núcleo CBAM",
    )

    S = getSampleStyleSheet()
    teal    = colors.HexColor(_PDF_TEAL)
    navy    = colors.HexColor(_PDF_NAVY)
    grey    = colors.HexColor(_PDF_GREY)
    lgrey   = colors.HexColor(_PDF_LGREY)
    black   = colors.HexColor(_PDF_BLACK)

    logo_style = ParagraphStyle(
        "Logo", parent=S["Normal"],
        fontSize=16, textColor=teal, fontName="Helvetica-Bold", spaceAfter=2,
    )
    tagline_style = ParagraphStyle(
        "Tagline", parent=S["Normal"],
        fontSize=8, textColor=grey, spaceAfter=10,
    )
    h1_style = ParagraphStyle(
        "H1", parent=S["Heading1"],
        fontSize=13, textColor=navy, fontName="Helvetica-Bold",
        spaceBefore=10, spaceAfter=4,
    )
    h2_style = ParagraphStyle(
        "H2", parent=S["Heading2"],
        fontSize=10, textColor=teal, fontName="Helvetica-Bold",
        spaceBefore=10, spaceAfter=4,
    )
    body_style = ParagraphStyle(
        "Body", parent=S["Normal"],
        fontSize=9, leading=14, textColor=black, spaceAfter=6,
    )
    small_style = ParagraphStyle(
        "Small", parent=S["Normal"],
        fontSize=8, leading=12, textColor=grey,
    )
    warn_style = ParagraphStyle(
        "Warn", parent=S["Normal"],
        fontSize=8, leading=12, textColor=colors.HexColor("#92400e"),
        backColor=colors.HexColor("#fffbeb"),
    )
    mono_style = ParagraphStyle(
        "Mono", parent=S["Normal"],
        fontSize=8, fontName="Courier", leading=12,
    )

    country = _country_name(req.origin_country)
    installation = req.installation_name or "[Installation name — please verify]"
    product = f"goods under CN {req.cn_code}"
    importer = req.importer_name or "[Importer]"
    eori = req.importer_eori or "[EORI]"
    year = req.reporting_year
    deadline = (date.today() + timedelta(days=30)).strftime("%-d %B %Y")
    jlabel = _jurisdiction_label(req.jurisdiction)
    reg_refs = req.regulation_refs

    story: list[Any] = []

    # ── Letterhead ─────────────────────────────────────────────────────────
    story.append(Paragraph("núcleo CBAM", logo_style))
    story.append(Paragraph("Carbon Border Adjustment Mechanism Compliance Platform", tagline_style))
    story.append(HRFlowable(width="100%", thickness=2, color=teal, spaceAfter=8))

    # From / date block
    today_str = date.today().strftime("%-d %B %Y")
    header_data = [
        [
            Paragraph(f"<b>From:</b> {importer}<br/>EORI: {eori}", body_style),
            Paragraph(f"<b>Date:</b> {today_str}", body_style),
        ]
    ]
    header_table = Table(header_data, colWidths=[11 * cm, 5 * cm])
    header_table.setStyle(TableStyle([
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 0.4 * cm))

    # To block
    story.append(Paragraph(f"<b>To:</b> {installation}<br/>{country}", body_style))
    story.append(Spacer(1, 0.3 * cm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=lgrey, spaceAfter=6))

    # Subject
    story.append(Paragraph(
        f"<b>SUBJECT: REQUEST FOR EMBEDDED EMISSIONS DATA — "
        f"{req.sector.replace('_', ' ').upper()}</b>",
        ParagraphStyle("Subject", parent=body_style, fontSize=9, textColor=navy),
    ))
    story.append(Paragraph(
        f"CN code: {req.cn_code}  |  Reporting year: {year}  |  "
        f"Goods line ref: {req.goods_line_id}",
        small_style,
    ))
    story.append(Spacer(1, 0.4 * cm))

    # ── Introduction ───────────────────────────────────────────────────────
    story.append(Paragraph("What is CBAM?", h2_style))
    story.append(Paragraph(
        f"The <b>{jlabel}</b> requires importers of certain carbon-intensive goods "
        "to declare the embedded greenhouse gas emissions associated with those goods "
        "and pay a carbon levy based on the embedded carbon content.  "
        f"The six CBAM sectors are: cement, iron and steel, aluminium, fertilisers, "
        "electricity, and hydrogen.",
        body_style,
    ))
    story.append(Paragraph(
        "Where importers cannot provide verified actual emissions data, the regulator "
        "requires the use of conservative published default values, which typically "
        "result in a higher carbon adjustment charge.  Providing accurate data "
        "therefore reduces the compliance cost for your customer.",
        body_style,
    ))

    # Regulatory basis
    story.append(Paragraph("Regulatory basis:", h2_style))
    for ref in reg_refs:
        story.append(Paragraph(f"• {ref}", body_style))
    story.append(Spacer(1, 0.2 * cm))

    # ── Data required table ────────────────────────────────────────────────
    story.append(Paragraph(
        f"Data Required — Calendar Year {year} (1 January – 31 December {year})",
        h1_style,
    ))

    rows = list(_COMMON_FIELDS) + list(_SECTOR_EXTRA_FIELDS.get(req.sector, []))
    table_data: list[list[Any]] = [[
        Paragraph("<b>#</b>", small_style),
        Paragraph("<b>Data field</b>", small_style),
        Paragraph("<b>Unit</b>", small_style),
        Paragraph("<b>Description</b>", small_style),
    ]]
    for i, (_fid, label, unit, desc) in enumerate(rows, start=1):
        table_data.append([
            Paragraph(str(i), small_style),
            Paragraph(f"<b>{label}</b>", small_style),
            Paragraph(unit, mono_style),
            Paragraph(desc, small_style),
        ])

    col_w = [(page_w - 5 * cm) / 10]  # helper
    data_table = Table(
        table_data,
        colWidths=[0.8 * cm, 4.0 * cm, 2.8 * cm, 8.4 * cm],
        repeatRows=1,
    )
    data_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), teal),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, lgrey]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("BOX", (0, 0), (-1, -1), 0.5, grey),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, lgrey),
    ]))
    story.append(data_table)
    story.append(Spacer(1, 0.4 * cm))

    # Production route options (sector-specific)
    route_opts = _SECTOR_ROUTE_OPTIONS.get(req.sector)
    if route_opts:
        story.append(Paragraph("Production Route Options", h2_style))
        for opt in route_opts:
            story.append(Paragraph(f"• {opt}", body_style))
        story.append(Spacer(1, 0.2 * cm))

    # ── Verification requirement ───────────────────────────────────────────
    story.append(Paragraph("Verification Requirement", h2_style))
    story.append(Paragraph(
        "The emissions data you provide may be subject to independent verification "
        "by a third-party verifier accredited by GACI (or an equivalent national "
        "accreditation body) operating to ISO 17029, ISO 14064-3, ISO 14065, "
        "and ISO 14066.  Please ensure the data is accurate and is supported by "
        "production records that can be made available to a verifier on request.  "
        "Importers must retain related documentation for <b>6 years</b>.",
        body_style,
    ))

    # Indirect note
    if req.sector in ("cement", "aluminium", "fertilisers"):
        story.append(Spacer(1, 0.2 * cm))
        story.append(Paragraph(
            "⚠ NOTE: Your sector requires reporting of both <b>direct</b> (scope 1) "
            "and <b>indirect</b> (scope 2, from purchased electricity) embedded "
            "emissions.  Please report both figures separately.",
            warn_style,
        ))

    # ── How to respond ─────────────────────────────────────────────────────
    story.append(Paragraph("How to Respond", h2_style))
    story.append(Paragraph(
        f"Please return completed data to <b>{importer}</b> by <b>{deadline}</b>.  "
        "Please include the methodology document or GHG inventory report from which "
        "the data is drawn, referenced to EU 2023/1773 Annex IV.  "
        "If you are unable to provide this data or need clarification, please contact "
        "us as soon as possible.",
        body_style,
    ))

    # Translation note
    if req.translation_recommended and req.translation_language_hint:
        story.append(Spacer(1, 0.3 * cm))
        story.append(Paragraph(
            f"[TRANSLATION NOTE] This letter is written in English.  If your team "
            f"requires it in {req.translation_language_hint}, please contact us and "
            "we will arrange translation before the data-request deadline.",
            warn_style,
        ))

    # ── Confidentiality + sign-off ─────────────────────────────────────────
    story.append(Spacer(1, 0.4 * cm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=lgrey, spaceAfter=6))
    story.append(Paragraph(
        "Emissions data you provide will be used solely for CBAM compliance purposes "
        "and treated as commercially sensitive.",
        small_style,
    ))
    story.append(Spacer(1, 0.6 * cm))
    story.append(Paragraph("Yours sincerely,", body_style))
    story.append(Spacer(1, 1.0 * cm))
    story.append(Paragraph(f"<b>{importer}</b>", body_style))
    story.append(Paragraph(f"EORI: {eori}", small_style))
    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph(
        "Generated by núcleo CBAM Compliance Platform", small_style
    ))

    doc.build(story, onFirstPage=_on_page, onLaterPages=_on_page)
    return buf.getvalue()


# ── Batch ZIP generator ─────────────────────────────────────────────────────────

def _safe_filename(s: str | None, fallback: str = "unknown") -> str:
    """Sanitise a string for use as a filename component."""
    if not s:
        return fallback
    return re.sub(r"[^\w\-]", "_", s)[:40]


def generate_batch_zip(
    requests: list[SupplierRequest],
    include_pdf: bool = True,
) -> bytes:
    """Pack a list of SupplierRequests into a ZIP archive.

    Each request produces two files (if include_pdf is True):
      {i:02d}_{origin}_{installation}_{cn_code}_email.txt
      {i:02d}_{origin}_{installation}_{cn_code}_letter.pdf

    A manifest (README.txt) is prepended with a summary table.

    Returns raw ZIP bytes suitable for streaming as application/zip.
    """
    buf = io.BytesIO()
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:

        # README / manifest
        manifest_lines = [
            "núcleo CBAM — Supplier Data Request Pack",
            "=" * 60,
            f"Generated: {generated}",
            f"Total requests: {len(requests)}",
            "",
            "CONTENTS",
            "-" * 60,
        ]
        for i, req in enumerate(requests, start=1):
            stem = (
                f"{i:02d}_{_safe_filename(req.origin_country, 'XX')}_"
                f"{_safe_filename(req.installation_name or req.cn_code)}_"
                f"{req.cn_code}"
            )
            manifest_lines.append(
                f"  {stem}_email.txt"
                + (f"\n  {stem}_letter.pdf" if include_pdf else "")
            )
        manifest_lines += [
            "",
            "NEXT STEPS",
            "-" * 60,
            "1. Review each email template and personalise where indicated.",
            "2. If translation is recommended, arrange translation before sending.",
            "3. Send to the relevant installation operator contact.",
            "4. Follow up if no response within 30 days.",
            "5. Upload returned emissions data into the núcleo CBAM platform.",
            "",
            "Each email specifies the exact data fields required under",
            "EU 2023/1773 Annex IV for your sector.",
        ]
        zf.writestr("README.txt", "\n".join(manifest_lines))

        # Per-request files
        for i, req in enumerate(requests, start=1):
            stem = (
                f"{i:02d}_{_safe_filename(req.origin_country, 'XX')}_"
                f"{_safe_filename(req.installation_name or req.cn_code)}_"
                f"{req.cn_code}"
            )

            # Email plain text
            email_content = f"Subject: {req.email_subject}\n\n{req.email_text}"
            zf.writestr(f"{stem}_email.txt", email_content.encode("utf-8"))

            # PDF letter
            if include_pdf:
                try:
                    pdf_bytes = render_pdf_letter(req)
                    zf.writestr(f"{stem}_letter.pdf", pdf_bytes)
                except Exception as exc:
                    zf.writestr(
                        f"{stem}_letter_ERROR.txt",
                        f"PDF generation failed: {exc}\n\n{req.email_text}".encode("utf-8"),
                    )

    return buf.getvalue()
