"""
CBAM Report Package export utilities.

Converts a ``cbam_report_package_v1`` dict into three downloadable formats:

- **JSON** — pretty-printed canonical JSON (UTF-8)
- **CSV**  — multi-section flat file; goods lines are one row each, with
             case metadata and audit trail as labelled header/footer blocks
- **PDF**  — structured A4 PDF generated with reportlab Platypus

All functions accept the report package dict returned by
``GET /api/cbam/cases/{id}/report-package`` and return bytes or str.
"""
from __future__ import annotations

import csv
import io
import json
from typing import Any

__all__ = ["to_json", "to_csv", "to_pdf"]

# Em-dash used as a placeholder for missing values in PDF/CSV output.
# Defined here so it can be used inside f-string expressions without
# triggering the "backslash in f-string expression" SyntaxError (Python <3.12).
_MDASH = "\u2014"


# ── Helpers ───────────────────────────────────────────────────────────────────


def _emission_fields(em: dict[str, Any]) -> tuple[Any, Any]:
    """Return (direct, indirect) emission values, tolerating both column names."""
    direct = em.get("direct_emissions_kgco2e") or em.get("direct_embedded_kgco2e")
    indirect = em.get("indirect_emissions_kgco2e") or em.get("indirect_embedded_kgco2e")
    return direct, indirect


def _mass_field(gl: dict[str, Any]) -> Any:
    return gl.get("net_mass_kg") or gl.get("quantity")


def _description_field(gl: dict[str, Any]) -> str:
    return str(gl.get("description") or gl.get("product_description") or "")


# ── JSON ──────────────────────────────────────────────────────────────────────


def to_json(report: dict[str, Any]) -> str:
    """Return indented JSON string of the report package."""
    return json.dumps(report, indent=2, default=str)


# ── CSV ───────────────────────────────────────────────────────────────────────


def to_csv(report: dict[str, Any]) -> str:
    """Return a UTF-8 CSV string of the report package.

    Structure
    ---------
    Section 1 — Report metadata (label, value rows)
    Section 2 — Case information (label, value rows)
    Section 3 — Data quality assessment (label, value rows)
    Section 4 — Goods lines (tabular, one row per goods line)
    Section 5 — Summary totals (label, value rows)
    Section 6 — Audit trail (label, value rows)
    """
    buf = io.StringIO()
    w = csv.writer(buf)

    def section(title: str) -> None:
        w.writerow([])
        w.writerow([f"== {title} =="])

    def kv(label: str, value: Any) -> None:
        w.writerow([label, "" if value is None else value])

    # ── Report metadata ────────────────────────────────────────────────────
    w.writerow(["CBAM Report Package"])
    kv("Report Type", report.get("type", ""))
    kv("Generated At", report.get("generated_at", ""))

    # ── Case information ───────────────────────────────────────────────────
    section("Case Information")
    w.writerow(["Field", "Value"])
    case = report.get("case") or {}
    for label, key in [
        ("Case ID",          "id"),
        ("Importer Name",    "importer_name"),
        ("Importer EORI",    "importer_eori"),
        ("Reporting Year",   "reporting_year"),
        ("Reporting Quarter","reporting_quarter"),
        ("Status",           "status"),
    ]:
        kv(label, case.get(key, ""))

    # ── Data quality ───────────────────────────────────────────────────────
    section("Data Quality Assessment")
    w.writerow(["Field", "Value"])
    dq = report.get("data_quality") or {}
    kv("Risk Tier", dq.get("risk_tier", ""))
    kv("Score",     dq.get("score", ""))
    kv("Blocking",  dq.get("blocking", ""))
    kv("Blocking Issues", "; ".join(str(m) for m in (dq.get("missing") or [])))
    kv("Warnings",        "; ".join(str(w_) for w_ in (dq.get("warnings") or [])))

    # ── Goods lines ────────────────────────────────────────────────────────
    section("Goods Lines")
    w.writerow([
        "Shipment ID", "Origin Country", "Import Date", "Entry Reference",
        "Goods Line ID", "CN Code", "Sector", "Description", "Net Mass (kg)",
        "Direct Emissions (kgCO2e)", "Indirect Emissions (kgCO2e)",
        "Total Embedded (kgCO2e)", "Calculation Method",
    ])
    for ship_item in (report.get("shipments") or []):
        shipment = ship_item.get("shipment") or {}
        ship_id      = shipment.get("id", "")
        origin       = shipment.get("origin_country", "")
        import_date  = shipment.get("import_date", "")
        entry_ref    = shipment.get("entry_reference", "")

        for gl_item in (ship_item.get("goods_lines") or []):
            gl = gl_item.get("goods_line") or {}
            em = gl_item.get("latest_emissions") or {}
            direct, indirect = _emission_fields(em)
            try:
                total = float(direct or 0) + float(indirect or 0)
            except (TypeError, ValueError):
                total = ""
            w.writerow([
                ship_id, origin, import_date, entry_ref,
                gl.get("id", ""),
                gl.get("cn_code", ""),
                gl.get("sector", ""),
                _description_field(gl),
                _mass_field(gl),
                direct,
                indirect,
                total,
                em.get("calculation_method") or em.get("method", ""),
            ])

    # ── Summary ────────────────────────────────────────────────────────────
    section("Summary Totals")
    w.writerow(["Field", "Value"])
    summary = report.get("summary") or {}
    for label, key in [
        ("Total Goods Lines",                  "total_goods_lines"),
        ("Total Net Mass (kg)",                "total_net_mass_kg"),
        ("Total Direct Emissions (kgCO2e)",    "total_direct_emissions_kgco2e"),
        ("Total Indirect Emissions (kgCO2e)",  "total_indirect_emissions_kgco2e"),
        ("Total Embedded Emissions (kgCO2e)",  "total_embedded_emissions_kgco2e"),
    ]:
        kv(label, summary.get(key, ""))

    # ── Audit trail ────────────────────────────────────────────────────────
    section("Audit Trail")
    w.writerow(["Field", "Value"])
    audit = report.get("audit") or {}
    algo  = audit.get("algo_versions") or {}
    kv("Payload Hash (SHA-256)", audit.get("payload_hash", ""))
    kv("Snapshot Hash",          audit.get("snapshot_hash", ""))
    kv("Document SHA-256",       audit.get("document_sha256", ""))
    kv("App Version",            algo.get("app_version", ""))
    kv("App Git SHA",            algo.get("app_git_sha", ""))
    kv("Run ID",                 algo.get("run_id", ""))
    kv("Report Package Builder", algo.get("report_package_builder", ""))

    return buf.getvalue()


# ── PDF ───────────────────────────────────────────────────────────────────────

# EU brand colours
_EU_BLUE = "#003399"
_EU_GOLD = "#FFCC00"
_RISK_COLOURS = {
    "blocking": "#e01e5a",
    "high":     "#f2552c",
    "medium":   "#f2c744",
    "low":      "#2eb886",
}


def to_pdf(report: dict[str, Any]) -> bytes:
    """Return a PDF byte string of the report package.

    Requires the ``reportlab`` package (``pip install reportlab``).
    Raises ``RuntimeError`` if reportlab is not installed.

    Layout
    ------
    1. Header — title, regulation ref, generation timestamp
    2. Case Details
    3. Data Quality Assessment (coloured by risk tier)
    4. Goods Lines table
    5. Summary Totals
    6. Audit Trail
    7. Footer — SHA / version / timestamp
    """
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.platypus import (
            HRFlowable,
            Paragraph,
            SimpleDocTemplate,
            Spacer,
            Table,
            TableStyle,
        )
    except ImportError as exc:
        raise RuntimeError(
            "reportlab is required for PDF export. Install it: pip install reportlab"
        ) from exc

    buf = io.BytesIO()
    case         = report.get("case") or {}
    generated_at = report.get("generated_at", "")

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=2 * cm,  bottomMargin=2 * cm,
        title="CBAM Report Package",
        author="scope3-agentic-platform",
    )

    styles   = getSampleStyleSheet()
    eu_blue  = colors.HexColor(_EU_BLUE)
    eu_gold  = colors.HexColor(_EU_GOLD)

    title_style = ParagraphStyle(
        "CBAMTitle", parent=styles["Title"],
        fontSize=18, textColor=eu_blue, spaceAfter=3,
    )
    sub_style = ParagraphStyle(
        "CBAMSub", parent=styles["Normal"],
        fontSize=9, textColor=colors.grey, spaceAfter=10,
    )
    section_style = ParagraphStyle(
        "CBAMSection", parent=styles["Heading2"],
        fontSize=11, textColor=eu_blue, spaceBefore=14, spaceAfter=4,
    )
    body_style = ParagraphStyle(
        "CBAMBody", parent=styles["Normal"], fontSize=9,
    )
    small_style = ParagraphStyle(
        "CBAMSmall", parent=styles["Normal"], fontSize=8, textColor=colors.grey,
    )
    mono_style = ParagraphStyle(
        "CBAMMono", parent=styles["Normal"], fontSize=7,
        fontName="Courier", textColor=colors.darkgrey,
    )

    def hr() -> HRFlowable:
        return HRFlowable(width="100%", thickness=0.5, color=eu_blue, spaceAfter=6)

    def kv_table(rows: list[tuple[str, Any]]) -> Table:
        data = [
            [Paragraph(f"<b>{k}</b>", body_style), Paragraph(str(v), body_style)]
            for k, v in rows
        ]
        t = Table(data, colWidths=[5 * cm, 12 * cm])
        t.setStyle(TableStyle([
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.whitesmoke, colors.white]),
            ("FONTSIZE",       (0, 0), (-1, -1), 9),
            ("TOPPADDING",     (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING",  (0, 0), (-1, -1), 3),
            ("LEFTPADDING",    (0, 0), (-1, -1), 6),
        ]))
        return t

    story = []

    # ── 1. Header ─────────────────────────────────────────────────────────
    story.append(Paragraph("EU CBAM Report Package", title_style))
    story.append(Paragraph(
        "Carbon Border Adjustment Mechanism \u2014 EU Regulation 2023/956", sub_style
    ))
    story.append(Paragraph(f"Generated: {generated_at}", small_style))
    story.append(hr())

    # ── 2. Case Details ───────────────────────────────────────────────────
    story.append(Paragraph("1. Case Details", section_style))
    story.append(kv_table([
        ("Case ID",          case.get("id", "\u2014")),
        ("Importer Name",    case.get("importer_name", "\u2014")),
        ("Importer EORI",    case.get("importer_eori", "\u2014")),
        ("Reporting Year",   case.get("reporting_year", "\u2014")),
        ("Reporting Quarter",f"Q{case.get('reporting_quarter', _MDASH)}"),
        ("Status",           case.get("status", "\u2014")),
    ]))

    # ── 3. Data Quality ───────────────────────────────────────────────────
    story.append(Paragraph("2. Data Quality Assessment", section_style))
    dq         = report.get("data_quality") or {}
    risk_tier  = dq.get("risk_tier", "unknown")
    risk_color = colors.HexColor(_RISK_COLOURS.get(risk_tier, "#888888"))

    dq_rows: list[tuple[str, Any]] = [
        ("Risk Tier", risk_tier.upper()),
        ("Score",     f"{dq.get('score', 0):.1f} / 100"),
        ("Blocking",  "YES \u2014 resolve before submission" if dq.get("blocking") else "No"),
    ]
    missing_list = dq.get("missing") or []
    if missing_list:
        dq_rows.append(("Blocking Issues", "\n".join(str(m) for m in missing_list)))
    warnings_list = dq.get("warnings") or []
    if warnings_list:
        dq_rows.append(("Warnings", "\n".join(str(w) for w in warnings_list)))

    dq_t = kv_table(dq_rows)
    # Colour the first row (Risk Tier) to match the tier
    dq_t.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, 0), risk_color),
        ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
        ("FONTSIZE",     (0, 0), (-1, -1), 9),
        ("TOPPADDING",   (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 3),
        ("LEFTPADDING",  (0, 0), (-1, -1), 6),
    ]))
    story.append(dq_t)

    # ── 4. Goods Lines ────────────────────────────────────────────────────
    story.append(Paragraph("3. Goods Lines", section_style))

    gl_header = [
        "CN Code", "Sector", "Net Mass\n(kg)",
        "Direct\n(kgCO\u2082e)", "Indirect\n(kgCO\u2082e)",
        "Embedded\n(kgCO\u2082e)", "Method",
    ]
    gl_data: list[list[Any]] = [gl_header]

    for ship_item in (report.get("shipments") or []):
        shipment = ship_item.get("shipment") or {}
        origin   = shipment.get("origin_country", "")
        entry    = shipment.get("entry_reference", "\u2014")
        ship_id  = str(shipment.get("id", ""))[:12]
        # Sub-header row spanning all columns
        gl_data.append([
            Paragraph(
                f"<b>Shipment {ship_id}\u2026 | Origin: {origin} | Ref: {entry}</b>",
                small_style,
            ),
            "", "", "", "", "", "",
        ])

        for gl_item in (ship_item.get("goods_lines") or []):
            gl = gl_item.get("goods_line") or {}
            em = gl_item.get("latest_emissions") or {}
            direct, indirect = _emission_fields(em)

            def _fmt_num(v: Any) -> str:
                try:
                    return f"{float(v):,.1f}"
                except (TypeError, ValueError):
                    return "\u2014"

            try:
                embedded_val = float(direct or 0) + float(indirect or 0)
                embedded = f"{embedded_val:,.1f}"
            except (TypeError, ValueError):
                embedded = "\u2014"

            mass = _mass_field(gl)
            gl_data.append([
                gl.get("cn_code", ""),
                gl.get("sector", ""),
                _fmt_num(mass) if mass is not None else "\u2014",
                _fmt_num(direct),
                _fmt_num(indirect),
                embedded,
                em.get("calculation_method") or em.get("method", "\u2014"),
            ])

    if len(gl_data) == 1:
        gl_data.append(["No goods lines recorded", "", "", "", "", "", ""])

    col_w = [2.2 * cm, 2.8 * cm, 2.4 * cm, 2.4 * cm, 2.4 * cm, 2.4 * cm, 2.4 * cm]
    gl_t  = Table(gl_data, colWidths=col_w, repeatRows=1)
    gl_t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), eu_blue),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, -1), 8),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.whitesmoke, colors.white]),
        ("GRID",          (0, 0), (-1, -1), 0.25, colors.lightgrey),
        ("TOPPADDING",    (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING",   (0, 0), (-1, -1), 4),
        ("ALIGN",         (2, 1), (-1, -1), "RIGHT"),
    ]))
    story.append(gl_t)

    # ── 5. Summary Totals ─────────────────────────────────────────────────
    story.append(Paragraph("4. Summary Totals", section_style))
    summary = report.get("summary") or {}
    story.append(kv_table([
        ("Total Goods Lines",                str(summary.get("total_goods_lines", "\u2014"))),
        ("Total Net Mass",         f"{summary.get('total_net_mass_kg', _MDASH)} kg"),
        ("Total Direct Emissions", f"{summary.get('total_direct_emissions_kgco2e', _MDASH)} kgCO\u2082e"),
        ("Total Indirect Emissions", f"{summary.get('total_indirect_emissions_kgco2e', _MDASH)} kgCO\u2082e"),
        ("Total Embedded Emissions", f"{summary.get('total_embedded_emissions_kgco2e', _MDASH)} kgCO\u2082e"),
    ]))

    # ── 6. Audit Trail ────────────────────────────────────────────────────
    story.append(Paragraph("5. Audit Trail", section_style))
    audit = report.get("audit") or {}
    algo  = audit.get("algo_versions") or {}
    story.append(kv_table([
        ("Payload Hash (SHA-256)", Paragraph(audit.get("payload_hash", "\u2014"), mono_style)),
        ("Snapshot Hash",          Paragraph(audit.get("snapshot_hash", "\u2014"), mono_style)),
        ("Document SHA-256",       Paragraph(audit.get("document_sha256") or "\u2014", mono_style)),
        ("App Version",            algo.get("app_version", "\u2014")),
        ("App Git SHA",            algo.get("app_git_sha", "\u2014")),
        ("Run ID",                 algo.get("run_id") or "\u2014"),
        ("Report Package Builder", algo.get("report_package_builder", "\u2014")),
    ]))

    # ── Footer ────────────────────────────────────────────────────────────
    story.append(Spacer(1, 0.5 * cm))
    story.append(hr())
    story.append(Paragraph(
        f"Generated by scope3-agentic-platform \u2502 EU CBAM Regulation 2023/956 \u2502 {generated_at}",
        small_style,
    ))

    doc.build(story)
    return buf.getvalue()
