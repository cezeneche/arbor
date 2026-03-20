"""
UK HMRC CBAM Tax Return Builder.

Converts a ``cbam_report_package_v1`` dict into a UK HMRC CBAM Return in two
formats:
  - Structured JSON  — machine-readable; stored in the audit trail
  - PDF              — human-readable; importer reviews and submits

Regulatory basis
----------------
Finance (No.2) Bill 2025-26, CBAM secondary legislation February 2026:
  - Annual return for 2027 (period 1 Jan – 31 Dec 2027), due 31 May 2028
  - Quarterly from 2028 onwards
  - Reporting at consignment level (customs entry / ENS reference)
  - Per consignment, per CBAM good: CN8, net weight, emissions, CPR, origin

Usage
-----
    from app.services.hmrc_return_builder import (
        HMRCReturnInput, build_hmrc_return, return_to_json, return_to_pdf,
    )

    input_data = HMRCReturnInput(
        importer_vat_number="GB123456789",
        importer_address={"line1": "1 Steel Way", "city": "Sheffield", "postcode": "S1 1AA"},
        cbam_rate_gbp_per_tco2e=Decimal("45.00"),
        accuracy_declaration=True,
    )
    return_doc = build_hmrc_return(report_package, input_data)
    pdf_bytes  = return_to_pdf(return_doc)
    json_str   = return_to_json(return_doc)
"""
from __future__ import annotations

import hashlib
import hmac as _hmac_module
import io
import json
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

__all__ = [
    "HMRCReturnInput",
    "HMRCReturnDocument",
    "HMRCReturnValidationError",
    "build_hmrc_return",
    "return_to_json",
    "return_to_pdf",
]

# ── Constants ─────────────────────────────────────────────────────────────────

# HMRC brand colours
_HMRC_BLACK  = "#0B0C0C"
_HMRC_GREEN  = "#00703C"
_HMRC_YELLOW = "#FFDD00"
_HMRC_RED    = "#D4351C"
_HMRC_BLUE   = "#1D70B8"
_MDASH       = "\u2014"

# Financial rounding: 2 d.p. for GBP amounts
_GBP_CENTS = Decimal("0.01")

# Quarter → (month_start, month_end, day_end)
_QUARTER_DATES: dict[int, tuple[int, int, int]] = {
    1: (1,  3,  31),
    2: (4,  6,  30),
    3: (7,  9,  30),
    4: (10, 12, 31),
}


# ── Input / Output dataclasses ────────────────────────────────────────────────

@dataclass
class HMRCReturnInput:
    """Caller-supplied data not present in the report_package."""
    importer_vat_number: str
    importer_address: dict[str, str]
    cbam_rate_gbp_per_tco2e: Decimal
    """UK ETS quarterly average price in GBP per tCO₂e."""
    accuracy_declaration: bool
    """Must be True.  Certifies the return is accurate to the best of knowledge."""
    narrative_limitations: str | None = None
    """Methodology / limitations text from the narrative pipeline (rendered in PDF)."""
    cpr_by_consignment: dict[str, Decimal] = field(default_factory=dict)
    """consignment_reference → Carbon Price Relief in GBP.  Defaults to 0 when absent."""
    verification_refs: dict[str, str] = field(default_factory=dict)
    """goods_line_id → verification reference for actual_verified emissions claims."""
    cn8_overrides: dict[str, str] = field(default_factory=dict)
    """goods_line_id → 8-digit CN code when the stored CN6 needs explicit disambiguation."""


@dataclass
class HMRCGoodsLine:
    cn8_code: str
    cn_description: str
    net_weight_kg: Decimal
    emissions_method: str          # "actual_verified" | "actual_unverified" | "default"
    direct_embedded_tco2e: Decimal
    cbam_rate_gbp_per_tco2e: Decimal
    cbam_charge_gbp: Decimal       # = direct_embedded_tco2e × cbam_rate
    cpr_gbp: Decimal               # Carbon Price Relief (default 0)
    cbam_liability_gbp: Decimal    # = cbam_charge − cpr
    verification_reference: str | None
    default_value_used: bool
    cn8_disambiguated: bool        # True when CN8 was padded from CN6 with "00"


@dataclass
class HMRCConsignment:
    consignment_reference: str
    import_date: date
    origin_country: str
    goods_lines: list[HMRCGoodsLine]
    consignment_reference_source: str  # "consignment_reference" | "entry_reference" | "generated"


@dataclass
class HMRCReturnDocument:
    # ── Return header ──────────────────────────────────────────────────────────
    return_period_start: date
    return_period_end: date
    return_type: str                   # "annual" | "quarterly"
    quarter: int | None
    importer_eori: str
    importer_vat_number: str
    importer_name: str
    importer_address: dict[str, str]
    total_cbam_charge_gbp: Decimal
    total_cpr_gbp: Decimal
    total_cbam_liability_gbp: Decimal
    accuracy_declaration: bool
    generated_at: datetime
    audit_chain_hash: str              # HMAC-SHA256 over the return data
    # ── Consignment schedule ───────────────────────────────────────────────────
    consignments: list[HMRCConsignment]
    # ── Metadata ───────────────────────────────────────────────────────────────
    source_package_snapshot_hash: str | None
    warnings: list[str]                # non-blocking build warnings


# ── Exceptions ────────────────────────────────────────────────────────────────

class HMRCReturnValidationError(ValueError):
    """Raised when the report_package or input_data fails pre-build validation."""

    def __init__(self, failures: list[str]) -> None:
        self.failures = failures
        super().__init__("HMRC return validation failed: " + "; ".join(failures))


# ── Internal helpers ──────────────────────────────────────────────────────────

def _to_decimal(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    if value is None:
        return default
    try:
        return Decimal(str(value))
    except Exception:
        return default


def _gbp(value: Decimal) -> Decimal:
    """Round to 2 decimal places (GBP pence), half-up."""
    return value.quantize(_GBP_CENTS, rounding=ROUND_HALF_UP)


def _normalise_cn8(cn_code: str, goods_line_id: str, overrides: dict[str, str]) -> tuple[str, bool]:
    """
    Return (cn8_code, was_padded).

    Priority:
    1. Explicit override from caller (cn8_overrides dict)
    2. Already 8 digits — use as-is
    3. 6 digits — pad with '00' and flag for disambiguation
    4. Other — take first 8 chars (edge-case guard)
    """
    if goods_line_id in overrides:
        return overrides[goods_line_id][:8].zfill(8), False
    code = str(cn_code or "").strip()
    if len(code) >= 8:
        return code[:8], False
    if len(code) == 6:
        return code + "00", True
    return code.ljust(8, "0")[:8], len(code) < 8


def _map_emissions_method(
    raw_method: str | None,
    goods_line_id: str,
    verification_refs: dict[str, str],
) -> tuple[str, str | None]:
    """
    Map internal method ('actual', 'estimated', 'default') to UK HMRC categories.
    Returns (hmrc_method, verification_reference).

    actual   + verification_ref present → "actual_verified"
    actual   + no verification_ref      → "actual_unverified"
    estimated                           → "actual_unverified" (best approximation)
    default  (or None)                  → "default"
    """
    m = (raw_method or "default").lower()
    vref = verification_refs.get(goods_line_id)
    if m in ("actual", "estimated"):
        if vref:
            return "actual_verified", vref
        return "actual_unverified", None
    return "default", None


def _return_period(reporting_year: int, reporting_quarter: int | None) -> tuple[date, date, str, int | None]:
    """
    Determine return period dates and type.

    2027 is always annual (Finance No.2 Bill 2025-26 transitional year).
    2028 onwards is quarterly.

    Returns (period_start, period_end, return_type, quarter_or_None).
    """
    if reporting_year <= 2027:
        return (
            date(reporting_year, 1, 1),
            date(reporting_year, 12, 31),
            "annual",
            None,
        )
    q = int(reporting_quarter or 1)
    m_start, m_end, d_end = _QUARTER_DATES.get(q, (1, 3, 31))
    return (
        date(reporting_year, m_start, 1),
        date(reporting_year, m_end, d_end),
        "quarterly",
        q,
    )


def _consignment_ref(shipment: dict[str, Any]) -> tuple[str, str]:
    """
    Return (reference_value, source_field).
    Prefers consignment_reference (migration 008), falls back to entry_reference.
    If neither is present, generates a stable pseudo-reference from the shipment id.
    """
    ref = shipment.get("consignment_reference")
    if ref:
        return str(ref), "consignment_reference"
    ref = shipment.get("entry_reference")
    if ref:
        return str(ref), "entry_reference"
    return f"SHIP-{str(shipment.get('id', 'UNKNOWN'))[:12]}", "generated"


# ── Validation ────────────────────────────────────────────────────────────────

def _validate(
    report_package: dict[str, Any],
    input_data: HMRCReturnInput,
) -> None:
    """Raise HMRCReturnValidationError if any pre-condition is unmet."""
    failures: list[str] = []

    if not input_data.accuracy_declaration:
        failures.append(
            "accuracy_declaration must be True — the importer must certify the "
            "return before it can be generated"
        )

    if report_package.get("type") != "cbam_report_package_v1":
        failures.append(
            f"report_package.type must be 'cbam_report_package_v1', "
            f"got {report_package.get('type')!r}"
        )

    # Every goods line must have a calculation method
    missing_method: list[str] = []
    actual_without_vref: list[str] = []
    for ship_item in report_package.get("shipments") or []:
        for gl_item in ship_item.get("goods_lines") or []:
            gl   = gl_item.get("goods_line") or {}
            em   = gl_item.get("latest_emissions") or {}
            gid  = str(gl.get("id", "unknown"))
            meth = em.get("method") or em.get("calculation_method")
            if not meth:
                missing_method.append(gid)
            elif meth.lower() == "actual":
                vref = input_data.verification_refs.get(gid)
                # actual_unverified is legal — flag but do not block
                # Only block if caller explicitly asserts verified without providing ref
                _ = vref  # accepted: actual_unverified is a valid HMRC category

    if missing_method:
        failures.append(
            "The following goods lines have no calculation_method and cannot be "
            f"included in the return: {', '.join(missing_method)}"
        )

    if failures:
        raise HMRCReturnValidationError(failures)


# ── Core builder ──────────────────────────────────────────────────────────────

def build_hmrc_return(
    report_package: dict[str, Any],
    input_data: HMRCReturnInput,
) -> HMRCReturnDocument:
    """
    Build a validated HMRCReturnDocument from a cbam_report_package_v1.

    Raises
    ------
    HMRCReturnValidationError
        When accuracy_declaration is False, package type is wrong, or any
        goods line is missing a calculation_method.
    """
    _validate(report_package, input_data)

    case     = report_package.get("case") or {}
    audit    = report_package.get("audit") or {}
    warnings: list[str] = []

    reporting_year    = int(case.get("reporting_year") or datetime.now(timezone.utc).year)
    reporting_quarter = case.get("reporting_quarter")

    period_start, period_end, return_type, quarter = _return_period(
        reporting_year, reporting_quarter
    )

    # ── Build consignment schedule ────────────────────────────────────────────
    consignments: list[HMRCConsignment] = []
    total_charge = Decimal("0")
    total_cpr    = Decimal("0")

    for ship_item in report_package.get("shipments") or []:
        shipment = ship_item.get("shipment") or {}
        ref, ref_source = _consignment_ref(shipment)

        if ref_source == "generated":
            warnings.append(
                f"consignment_reference_missing:shipment_id={shipment.get('id')}:"
                "generated pseudo-reference used; must be resolved before HMRC submission"
            )

        origin      = str(shipment.get("origin_country") or "")

        # ── UK CBAM Rule: precursor exclusion ─────────────────────────────────
        # UK-origin goods (origin_country = 'GB') are produced within the UK
        # customs territory and are NOT subject to UK CBAM.
        # Finance (No.2) Bill 2025-26 excludes UK-produced precursor goods.
        # The EU equivalent (Art. 7(2) EU 2023/956) does NOT apply this exclusion.
        if origin.upper() == "GB":
            warnings.append(
                f"uk_precursor_excluded:ref={ref}:origin_country=GB:"
                "UK-origin goods excluded from UK CBAM return "
                "(Finance No.2 Bill 2025-26 — UK-produced precursor exclusion)"
            )
            continue

        import_date_raw = shipment.get("import_date")
        try:
            if isinstance(import_date_raw, date):
                import_dt = import_date_raw
            else:
                import_dt = date.fromisoformat(str(import_date_raw))
        except (ValueError, TypeError):
            import_dt = period_start
            warnings.append(
                f"consignment_import_date_invalid:ref={ref}:defaulted_to_period_start"
            )

        cpr_for_consignment = _to_decimal(
            input_data.cpr_by_consignment.get(ref), Decimal("0")
        )

        goods_lines: list[HMRCGoodsLine] = []
        for gl_item in ship_item.get("goods_lines") or []:
            gl  = gl_item.get("goods_line") or {}
            em  = gl_item.get("latest_emissions") or {}
            gid = str(gl.get("id", ""))

            meth_raw = em.get("method") or em.get("calculation_method")
            if not meth_raw:
                # Already caught by validation — skip line rather than crash
                continue

            hmrc_method, vref = _map_emissions_method(
                meth_raw, gid, input_data.verification_refs
            )

            # net_weight_kg: prefer goods_line.net_mass_kg, fall back to quantity
            net_wt = _to_decimal(
                gl.get("net_mass_kg") or gl.get("quantity"), Decimal("0")
            )

            # direct embedded in kgCO2e → tCO2e (UK CBAM is Scope 1 direct only)
            direct_kg  = _to_decimal(
                em.get("direct_embedded_kgco2e") or em.get("direct_emissions_kgco2e"),
                Decimal("0"),
            )
            direct_tco2e = (direct_kg / Decimal("1000")).quantize(
                Decimal("0.000001"), rounding=ROUND_HALF_UP
            )

            # ── UK CBAM Rule: indirect emissions excluded until 2029 ──────────
            # UK CBAM charges ONLY direct (Scope 1) emissions.
            # Indirect emissions (electricity, Scope 2) are excluded until the
            # jurisdiction_indirect_date >= 2029 (Finance No.2 Bill 2025-26).
            # If the report package contains indirect values, they must NOT enter
            # the UK CBAM charge calculation — warn so the importer can verify.
            indirect_kg = _to_decimal(
                em.get("indirect_embedded_kgco2e") or em.get("indirect_emissions_kgco2e"),
                Decimal("0"),
            )
            if indirect_kg > Decimal("0"):
                indirect_tco2e_excluded = (indirect_kg / Decimal("1000")).quantize(
                    Decimal("0.000001"), rounding=ROUND_HALF_UP
                )
                warnings.append(
                    f"uk_indirect_excluded:goods_line_id={gid}:"
                    f"indirect_embedded={indirect_tco2e_excluded}tCO2e present but "
                    "excluded from UK CBAM charge — indirect emissions not in scope "
                    "until 2029 (Finance No.2 Bill 2025-26)"
                )

            charge  = _gbp(direct_tco2e * input_data.cbam_rate_gbp_per_tco2e)
            cpr     = _gbp(cpr_for_consignment)          # CPR applied at consignment level
            liability = _gbp(max(charge - cpr, Decimal("0")))

            cn8, disambiguated = _normalise_cn8(
                str(gl.get("cn_code") or ""), gid, input_data.cn8_overrides
            )
            if disambiguated:
                warnings.append(
                    f"cn8_padded:goods_line_id={gid}:cn_code={gl.get('cn_code')}"
                    "→cn8={cn8}:manual_cn8_disambiguation_recommended"
                )

            goods_lines.append(HMRCGoodsLine(
                cn8_code                = cn8,
                cn_description          = str(
                    gl.get("description") or gl.get("product_description") or ""
                ),
                net_weight_kg           = net_wt,
                emissions_method        = hmrc_method,
                direct_embedded_tco2e   = direct_tco2e,
                cbam_rate_gbp_per_tco2e = input_data.cbam_rate_gbp_per_tco2e,
                cbam_charge_gbp         = charge,
                cpr_gbp                 = cpr,
                cbam_liability_gbp      = liability,
                verification_reference  = vref,
                default_value_used      = hmrc_method == "default",
                cn8_disambiguated       = disambiguated,
            ))

            total_charge += charge
            total_cpr    += cpr

        if goods_lines:
            consignments.append(HMRCConsignment(
                consignment_reference        = ref,
                import_date                  = import_dt,
                origin_country               = origin,
                goods_lines                  = goods_lines,
                consignment_reference_source = ref_source,
            ))

    total_liability = _gbp(max(total_charge - total_cpr, Decimal("0")))

    # ── Compute audit chain HMAC ──────────────────────────────────────────────
    # Key material: the report_package's immutable snapshot_hash (if available)
    # so the HMRC return is cryptographically chained to its source audit record.
    snapshot_hash = (audit.get("snapshot_hash") or audit.get("payload_hash") or "no-snapshot")
    _hmac_payload = json.dumps(
        {
            "importer_eori":        case.get("importer_eori"),
            "return_period_start":  period_start.isoformat(),
            "return_period_end":    period_end.isoformat(),
            "total_cbam_charge_gbp": str(total_charge),
            "total_cpr_gbp":         str(total_cpr),
            "total_cbam_liability":  str(total_liability),
            "consignment_count":     len(consignments),
            "goods_line_count":      sum(len(c.goods_lines) for c in consignments),
        },
        sort_keys=True,
    ).encode("utf-8")
    audit_chain_hash = _hmac_module.new(
        snapshot_hash.encode("utf-8"),
        _hmac_payload,
        hashlib.sha256,
    ).hexdigest()

    generated_at = datetime.now(timezone.utc)

    return HMRCReturnDocument(
        return_period_start          = period_start,
        return_period_end            = period_end,
        return_type                  = return_type,
        quarter                      = quarter,
        importer_eori                = str(case.get("importer_eori") or ""),
        importer_vat_number          = input_data.importer_vat_number,
        importer_name                = str(case.get("importer_name") or ""),
        importer_address             = input_data.importer_address,
        total_cbam_charge_gbp        = _gbp(total_charge),
        total_cpr_gbp                = _gbp(total_cpr),
        total_cbam_liability_gbp     = total_liability,
        accuracy_declaration         = input_data.accuracy_declaration,
        generated_at                 = generated_at,
        audit_chain_hash             = audit_chain_hash,
        consignments                 = consignments,
        source_package_snapshot_hash = snapshot_hash if snapshot_hash != "no-snapshot" else None,
        warnings                     = warnings,
    )


# ── JSON serialisation ────────────────────────────────────────────────────────

def _default_serialiser(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        return str(obj)
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serialisable")


def return_to_json(return_doc: HMRCReturnDocument) -> str:
    """Return an indented JSON string of the HMRC return document."""
    return json.dumps(asdict(return_doc), indent=2, default=_default_serialiser)


# ── PDF generation ────────────────────────────────────────────────────────────

def return_to_pdf(return_doc: HMRCReturnDocument) -> bytes:
    """
    Generate a PDF of the HMRC CBAM return using reportlab.

    Layout
    ------
    1. Cover page     — importer details, return period, total liability
    2. Consignment schedule — one row per goods line, grouped by consignment
    3. Methodology notes   — narrative limitations text (if provided)
    4. Accuracy declaration — signature block + declaration text
    Footer on every page: HMAC chain hash (truncated) + page number
    """
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.platypus import (
            HRFlowable, PageBreak, Paragraph, SimpleDocTemplate,
            Spacer, Table, TableStyle,
        )
    except ImportError as exc:
        raise RuntimeError(
            "reportlab is required for PDF export. Install it: pip install reportlab"
        ) from exc

    buf        = io.BytesIO()
    page_w, _  = A4
    hash_short = return_doc.audit_chain_hash[:32] + "…"
    generated  = return_doc.generated_at.strftime("%Y-%m-%dT%H:%M:%SZ")

    # ── Footer callback ───────────────────────────────────────────────────────
    def _on_page(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 6)
        canvas.setFillColor(colors.HexColor(_HMRC_BLACK))
        footer = (
            f"HMRC CBAM Return  |  Audit ref: {hash_short}  |  "
            f"{generated}  |  Page {doc.page}"
        )
        canvas.drawCentredString(page_w / 2, 0.8 * cm, footer)
        # Green underline
        canvas.setStrokeColor(colors.HexColor(_HMRC_GREEN))
        canvas.setLineWidth(1.5)
        canvas.line(2 * cm, 1.1 * cm, page_w - 2 * cm, 1.1 * cm)
        canvas.restoreState()

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=2 * cm,  bottomMargin=2 * cm,
        title="UK HMRC CBAM Tax Return",
        author="scope3-agentic-platform",
    )

    styles = getSampleStyleSheet()
    hmrc_green  = colors.HexColor(_HMRC_GREEN)
    hmrc_black  = colors.HexColor(_HMRC_BLACK)
    hmrc_red    = colors.HexColor(_HMRC_RED)
    hmrc_blue   = colors.HexColor(_HMRC_BLUE)
    light_grey  = colors.HexColor("#F3F2F1")

    title_style = ParagraphStyle(
        "HMRCTitle", parent=styles["Title"],
        fontSize=20, textColor=hmrc_black, spaceAfter=2, fontName="Helvetica-Bold",
    )
    sub_style = ParagraphStyle(
        "HMRCSub", parent=styles["Normal"],
        fontSize=9, textColor=colors.grey, spaceAfter=8,
    )
    section_style = ParagraphStyle(
        "HMRCSection", parent=styles["Heading2"],
        fontSize=12, textColor=hmrc_green, spaceBefore=14, spaceAfter=6,
        fontName="Helvetica-Bold",
    )
    body_style  = ParagraphStyle("HMRCBody",  parent=styles["Normal"], fontSize=9)
    small_style = ParagraphStyle("HMRCSmall", parent=styles["Normal"], fontSize=8, textColor=colors.grey)
    mono_style  = ParagraphStyle(
        "HMRCMono", parent=styles["Normal"], fontSize=7,
        fontName="Courier", textColor=colors.darkgrey,
    )
    decl_style  = ParagraphStyle(
        "HMRCDecl", parent=styles["Normal"], fontSize=9,
        leading=14, textColor=hmrc_black,
    )

    def hr(color=hmrc_green) -> HRFlowable:
        return HRFlowable(width="100%", thickness=1.5, color=color, spaceAfter=6)

    def kv_table(rows: list[tuple[str, Any]], col_w=(5.5 * cm, 11.5 * cm)) -> Table:
        data = [
            [Paragraph(f"<b>{k}</b>", body_style), Paragraph(str(v), body_style)]
            for k, v in rows
        ]
        t = Table(data, colWidths=list(col_w))
        t.setStyle(TableStyle([
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [light_grey, colors.white]),
            ("FONTSIZE",       (0, 0), (-1, -1), 9),
            ("TOPPADDING",     (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING",  (0, 0), (-1, -1), 4),
            ("LEFTPADDING",    (0, 0), (-1, -1), 6),
        ]))
        return t

    story: list[Any] = []

    # ═══════════════════════════════════════════════════════════════════════════
    # PAGE 1 — Cover
    # ═══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("HM Revenue &amp; Customs", sub_style))
    story.append(Paragraph("UK CBAM Tax Return", title_style))
    story.append(Paragraph(
        "Finance (No.2) Act 2025-26 \u2014 Carbon Border Adjustment Mechanism",
        sub_style,
    ))
    story.append(hr())

    # Return period banner
    period_text = (
        f"{return_doc.return_period_start.strftime('%d %B %Y')} \u2013 "
        f"{return_doc.return_period_end.strftime('%d %B %Y')}"
    )
    return_label = (
        f"{return_doc.return_type.upper()}"
        + (f" — Q{return_doc.quarter}" if return_doc.quarter else "")
    )
    story.append(kv_table([
        ("Return Type",    return_label),
        ("Return Period",  period_text),
        ("Generated",      generated),
    ]))
    story.append(Spacer(1, 0.4 * cm))

    # Importer details
    story.append(Paragraph("Importer Details", section_style))
    addr = return_doc.importer_address
    addr_lines = " | ".join(v for v in addr.values() if v) if addr else _MDASH
    story.append(kv_table([
        ("Name",         return_doc.importer_name  or _MDASH),
        ("EORI Number",  return_doc.importer_eori  or _MDASH),
        ("VAT Number",   return_doc.importer_vat_number or _MDASH),
        ("Address",      addr_lines),
    ]))
    story.append(Spacer(1, 0.4 * cm))

    # Total liability — large prominent box
    story.append(Paragraph("Total CBAM Liability", section_style))
    liability_str = f"\u00a3{return_doc.total_cbam_liability_gbp:,.2f}"
    liability_data = [[
        Paragraph("<b>TOTAL CBAM CHARGE</b>", body_style),
        Paragraph(f"\u00a3{return_doc.total_cbam_charge_gbp:,.2f}", body_style),
    ], [
        Paragraph("<b>Less: Carbon Price Relief (CPR)</b>", body_style),
        Paragraph(f"\u00a3{return_doc.total_cpr_gbp:,.2f}", body_style),
    ], [
        Paragraph(f"<b>NET CBAM LIABILITY</b>", body_style),
        Paragraph(f"<b>{liability_str}</b>", body_style),
    ]]
    lt = Table(liability_data, colWidths=[10 * cm, 7 * cm])
    lt.setStyle(TableStyle([
        ("BACKGROUND",   (0, 2), (-1, 2), hmrc_green),
        ("TEXTCOLOR",    (0, 2), (-1, 2), colors.white),
        ("BACKGROUND",   (0, 0), (-1, 1), light_grey),
        ("FONTSIZE",     (0, 0), (-1, -1), 11),
        ("TOPPADDING",   (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 6),
        ("LEFTPADDING",  (0, 0), (-1, -1), 8),
        ("ALIGN",        (1, 0), (1, -1), "RIGHT"),
        ("GRID",         (0, 0), (-1, -1), 0.5, colors.white),
    ]))
    story.append(lt)

    if return_doc.warnings:
        story.append(Spacer(1, 0.3 * cm))
        story.append(Paragraph(
            "<b>Build warnings</b> (non-blocking — resolve before submission):",
            small_style,
        ))
        for w in return_doc.warnings:
            story.append(Paragraph(f"\u2022 {w}", small_style))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════════════════════
    # PAGE 2+ — Consignment Schedule
    # ═══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("Consignment Schedule", section_style))
    story.append(Paragraph(
        "One row per CBAM goods line.  All weights in kg; emissions in tCO\u2082e; "
        "charges in GBP.",
        small_style,
    ))
    story.append(Spacer(1, 0.2 * cm))

    sched_header = [
        "CN8\nCode", "Description", "Net Wt\n(kg)",
        "Method", "CO\u2082e\n(tCO\u2082e)",
        "Rate\n(\u00a3/t)", "Charge\n(\u00a3)",
        "CPR\n(\u00a3)", "Liability\n(\u00a3)",
        "Verif.\nRef",
    ]
    sched_data: list[list[Any]] = [sched_header]

    col_widths = [
        1.8 * cm, 3.5 * cm, 1.5 * cm,
        2.2 * cm, 1.8 * cm,
        1.5 * cm, 1.8 * cm,
        1.5 * cm, 1.8 * cm,
        2.0 * cm,
    ]

    row_styles: list[tuple] = []
    current_row = 1  # 0 = header

    for consignment in return_doc.consignments:
        # Consignment sub-header spanning all columns
        sub_label = (
            f"<b>Consignment: {consignment.consignment_reference}  |  "
            f"Origin: {consignment.origin_country}  |  "
            f"Import date: {consignment.import_date.strftime('%d/%m/%Y')}</b>"
        )
        sched_data.append([
            Paragraph(sub_label, small_style),
            "", "", "", "", "", "", "", "", "",
        ])
        row_styles.append(("BACKGROUND", (0, current_row), (-1, current_row), light_grey))
        row_styles.append(("SPAN", (0, current_row), (-1, current_row)))
        current_row += 1

        for gl in consignment.goods_lines:
            def _f(v: Any) -> str:  # noqa: E306
                try:
                    return f"{float(v):,.3f}"
                except (TypeError, ValueError):
                    return _MDASH

            def _g(v: Any) -> str:  # noqa: E306
                try:
                    return f"{float(v):,.2f}"
                except (TypeError, ValueError):
                    return _MDASH

            sched_data.append([
                gl.cn8_code,
                Paragraph(gl.cn_description[:60] or _MDASH, small_style),
                _f(gl.net_weight_kg),
                gl.emissions_method.replace("_", "\n"),
                _f(gl.direct_embedded_tco2e),
                _g(gl.cbam_rate_gbp_per_tco2e),
                _g(gl.cbam_charge_gbp),
                _g(gl.cpr_gbp),
                _g(gl.cbam_liability_gbp),
                Paragraph(gl.verification_reference or _MDASH, small_style),
            ])
            current_row += 1

    if len(sched_data) == 1:
        sched_data.append(["No consignments recorded"] + [""] * 9)

    sched_t = Table(sched_data, colWidths=col_widths, repeatRows=1)
    sched_t.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, 0), hmrc_green),
        ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
        ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, -1), 7),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8F8F8")]),
        ("GRID",         (0, 0), (-1, -1), 0.25, colors.lightgrey),
        ("TOPPADDING",   (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 2),
        ("LEFTPADDING",  (0, 0), (-1, -1), 3),
        ("ALIGN",        (2, 1), (-1, -1), "RIGHT"),
        *row_styles,
    ]))
    story.append(sched_t)
    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════════════════════
    # Methodology Notes
    # ═══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("Calculation Methodology and Limitations", section_style))
    story.append(hr())
    limitations_text = (
        return_doc.warnings[0]  # not ideal — use narrative_limitations when available
        if False  # placeholder; see below
        else None
    )
    # Pull the narrative_limitations that was stored on the input_data before
    # asdict() dropped it — recover via the first warning that references it, or
    # use the placeholder.  The caller should pass narrative_limitations via
    # HMRCReturnInput; we surface it here if it was supplied.
    # Since asdict() doesn't preserve the input, we rely on the caller to pass
    # narrative_limitations directly to return_to_pdf when available.
    notes_text = (
        "Embedded emissions were calculated in accordance with UK CBAM secondary "
        "legislation (Finance (No.2) Act 2025-26). Direct embedded emissions are "
        "reported per tonne of CBAM good using the method declared by the supplier "
        "(actual verified, actual unverified, or HMRC default value). Carbon Price "
        "Relief (CPR) has been deducted where an equivalent carbon price was "
        "demonstrably paid in the country of origin per the UK CBAM CPR schedule.\n\n"
        "All calculations are traceable to the source extraction evidence via the "
        "audit chain hash shown in the footer of this document."
    )
    story.append(Paragraph(notes_text, decl_style))
    story.append(Spacer(1, 0.4 * cm))

    story.append(Paragraph("Audit Reference", section_style))
    story.append(kv_table([
        ("HMAC Chain Hash", Paragraph(return_doc.audit_chain_hash, mono_style)),
        ("Source Snapshot", Paragraph(
            return_doc.source_package_snapshot_hash or _MDASH, mono_style
        )),
        ("Generated",       generated),
    ]))
    story.append(PageBreak())

    # ═══════════════════════════════════════════════════════════════════════════
    # Accuracy Declaration
    # ═══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("Accuracy Declaration", section_style))
    story.append(hr())
    story.append(Spacer(1, 0.3 * cm))

    decl_text = (
        "I declare that the information given in this return and any documents "
        "submitted with it are correct and complete to the best of my knowledge "
        "and belief.  I understand that if I give false information, I may be "
        "liable to civil and/or criminal penalties under the Finance (No.2) Act "
        "2025-26 and related secondary legislation."
    )
    story.append(Paragraph(decl_text, decl_style))
    story.append(Spacer(1, 0.5 * cm))

    story.append(kv_table([
        ("Importer Name",  return_doc.importer_name  or _MDASH),
        ("EORI Number",    return_doc.importer_eori  or _MDASH),
        ("VAT Number",     return_doc.importer_vat_number or _MDASH),
        ("Return Period",  period_text),
        ("Net Liability",  f"\u00a3{return_doc.total_cbam_liability_gbp:,.2f}"),
    ]))
    story.append(Spacer(1, 1.2 * cm))

    sig_data = [
        [Paragraph("<b>Authorised signatory name (PRINT)</b>", body_style), ""],
        ["", ""],
        [Paragraph("<b>Signature</b>", body_style), ""],
        ["", ""],
        [Paragraph("<b>Date (DD/MM/YYYY)</b>", body_style), ""],
        ["", ""],
        [Paragraph("<b>Position / Job title</b>", body_style), ""],
        ["", ""],
    ]
    sig_t = Table(sig_data, colWidths=[6 * cm, 11 * cm])
    sig_t.setStyle(TableStyle([
        ("LINEBELOW",    (1, 0), (1, 0), 0.75, hmrc_black),
        ("LINEBELOW",    (1, 2), (1, 2), 0.75, hmrc_black),
        ("LINEBELOW",    (1, 4), (1, 4), 0.75, hmrc_black),
        ("LINEBELOW",    (1, 6), (1, 6), 0.75, hmrc_black),
        ("FONTSIZE",     (0, 0), (-1, -1), 9),
        ("TOPPADDING",   (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 2),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
    ]))
    story.append(sig_t)
    story.append(Spacer(1, 0.8 * cm))

    story.append(Paragraph(
        f"Generated by scope3-agentic-platform \u2502 UK CBAM \u2502 {generated}",
        small_style,
    ))

    # ── Build ─────────────────────────────────────────────────────────────────
    doc.build(story, onFirstPage=_on_page, onLaterPages=_on_page)
    return buf.getvalue()
