from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.engine import Connection

from ledger_app.services.cbam_data_quality import evaluate_cbam_data_quality
from ledger_app.services.snapshot_store import canonical_json, sha256_hex

from .schemas import CBAMDraftFromParsedInvoiceRequest
from .db_helpers import (
    _coerce_float,
    _parse_iso_date,
    _pick_existing,
    _quarter_from_date,
    _table_columns,
)
from .audit_helpers import (
    _append_llm_evidence,
    _document_sha256_from_extraction_snapshot,
    _evidence_documents_from_snapshot,
)


def _report_package_audit_block(
    *,
    case_id: str,
    artifact_payload: dict[str, object],
    generated_at: str,
    snapshot_hash: str | None,
    parent_hash: str | None,
    algo_versions: dict[str, object] | None = None,
    model_versions: dict[str, object] | None = None,
) -> dict[str, object]:
    from ledger_app.core.version import APP_GIT_SHA, APP_VERSION

    evidence_docs = _evidence_documents_from_snapshot(case_id)
    primary_sha256 = (
        evidence_docs[0]["document_sha256"]
        if evidence_docs
        else _document_sha256_from_extraction_snapshot(case_id)
    )
    merged_algo = dict(algo_versions or {})
    merged_algo.setdefault("app_git_sha", APP_GIT_SHA)
    merged_algo.setdefault("app_version", APP_VERSION)
    return {
        "document_sha256": primary_sha256,
        "evidence_documents": evidence_docs,
        "payload_hash": sha256_hex(canonical_json(artifact_payload)),
        "snapshot_hash": snapshot_hash,
        "parent_hash": parent_hash,
        "algo_versions": merged_algo,
        "model_versions": model_versions or {},
        "generated_at": generated_at,
    }


def _build_parsed_invoice_request_from_extraction(
    extraction: dict[str, object],
    importer_name: str | None,
    importer_eori: str | None,
    reporting_year: int | None,
    reporting_quarter: int | None,
    consignment_reference: str | None = None,
    customs_procedure_code: str | None = None,
    net_weight_kg: Decimal | None = None,
    is_temporary_admission: bool = False,
) -> tuple[CBAMDraftFromParsedInvoiceRequest, int, int, list[str]]:
    warnings: list[str] = []

    structured = extraction.get("structured")
    structured_data = structured if isinstance(structured, dict) else {}
    importer_data = extraction.get("importer")
    invoice_data = extraction.get("invoice")
    lines_data = extraction.get("lines")
    emissions_data = extraction.get("emissions")

    parsed_importer_name = (
        importer_name
        or (importer_data.get("name") if isinstance(importer_data, dict) else None)
        or structured_data.get("importer_name")
    )
    parsed_importer_eori = (
        importer_eori
        or (importer_data.get("eori") if isinstance(importer_data, dict) else None)
        or structured_data.get("importer_eori")
    )
    if not parsed_importer_eori:
        # EORI not found in document — flag for completion before HMRC submission
        # rather than rejecting the upload entirely (DQ precheck will mark as blocking)
        parsed_importer_eori = ""
        warnings.append("importer_eori_missing:flag_for_human_completion_before_hmrc_submission")

    parsed_invoice_number = None
    parsed_origin_country = None
    parsed_incoterm = None
    parsed_entry_reference = None
    parsed_invoice_date: date | None = None

    if isinstance(invoice_data, dict):
        parsed_invoice_number = invoice_data.get("invoice_number")
        parsed_origin_country = invoice_data.get("origin_country")
        parsed_incoterm = invoice_data.get("incoterm")
        parsed_entry_reference = invoice_data.get("entry_reference")
        parsed_invoice_date = _parse_iso_date(invoice_data.get("invoice_date"))

    if parsed_origin_country is None:
        parsed_origin_country = structured_data.get("origin_country")
    if parsed_invoice_date is None:
        parsed_invoice_date = _parse_iso_date(structured_data.get("invoice_date"))

    resolved_reporting_year = reporting_year
    resolved_reporting_quarter = reporting_quarter

    if resolved_reporting_year is None and parsed_invoice_date is not None:
        resolved_reporting_year = parsed_invoice_date.year
    if resolved_reporting_quarter is None and parsed_invoice_date is not None:
        resolved_reporting_quarter = _quarter_from_date(parsed_invoice_date)

    if resolved_reporting_year is None:
        resolved_reporting_year = date.today().year
        warnings.append("Missing reporting_year; defaulted to current year.")
    if resolved_reporting_quarter is None:
        resolved_reporting_quarter = 1
        warnings.append("Missing reporting_quarter; defaulted to Q1.")
    if resolved_reporting_quarter not in (1, 2, 3, 4):
        raise ValueError("reporting_quarter must be between 1 and 4.")

    if parsed_invoice_date is None:
        quarter_start_month = ((resolved_reporting_quarter - 1) * 3) + 1
        parsed_invoice_date = date(resolved_reporting_year, quarter_start_month, 1)
        warnings.append(
            "Missing invoice_date; defaulted to first day of the resolved reporting quarter."
        )

    parsed_lines: list[dict[str, object]] = []
    if isinstance(lines_data, list) and lines_data:
        for line in lines_data:
            if isinstance(line, dict):
                quantity_value = _coerce_float(line.get("quantity"), "quantity")
                net_mass_value = _coerce_float(line.get("net_mass_kg"), "net_mass_kg")
                line_direct_value = _coerce_float(
                    line.get("direct_embedded_kgco2e"),
                    "direct_embedded_kgco2e",
                )
                line_indirect_value = _coerce_float(
                    line.get("indirect_embedded_kgco2e"),
                    "indirect_embedded_kgco2e",
                )
                parsed_lines.append(
                    {
                        "cn_code": line.get("cn_code"),
                        "description": line.get("description"),
                        "quantity": quantity_value,
                        "quantity_unit": line.get("quantity_unit"),
                        "net_mass_kg": net_mass_value,
                        "method": line.get("method"),
                        "direct_embedded_kgco2e": line_direct_value,
                        "indirect_embedded_kgco2e": line_indirect_value,
                    }
                )
    else:
        cn_code = structured_data.get("cn_code")
        if cn_code:
            structured_mass = _coerce_float(structured_data.get("net_mass_kg"), "net_mass_kg")
            parsed_lines.append(
                {
                    "cn_code": cn_code,
                    "description": None,
                    "quantity": structured_mass,
                    "quantity_unit": "kg",
                    "net_mass_kg": structured_mass,
                    "method": None,
                    "direct_embedded_kgco2e": None,
                    "indirect_embedded_kgco2e": None,
                }
            )

    if not parsed_lines:
        raise ValueError("No invoice lines were extracted from the document.")

    parsed_emissions: dict[str, object] | None = None
    if isinstance(emissions_data, dict):
        parsed_emissions = {
            "method": emissions_data.get("method"),
            "direct_embedded_kgco2e": _coerce_float(
                emissions_data.get("direct_embedded_kgco2e"),
                "direct_embedded_kgco2e",
            ),
            "indirect_embedded_kgco2e": _coerce_float(
                emissions_data.get("indirect_embedded_kgco2e"),
                "indirect_embedded_kgco2e",
            ),
        }
    elif (
        structured_data.get("method") is not None
        or structured_data.get("direct_embedded_kgco2e") is not None
        or structured_data.get("indirect_embedded_kgco2e") is not None
    ):
        parsed_emissions = {
            "method": structured_data.get("method"),
            "direct_embedded_kgco2e": _coerce_float(
                structured_data.get("direct_embedded_kgco2e"),
                "direct_embedded_kgco2e",
            ),
            "indirect_embedded_kgco2e": _coerce_float(
                structured_data.get("indirect_embedded_kgco2e"),
                "indirect_embedded_kgco2e",
            ),
        }

    # consignment_reference: caller-supplied value takes priority over anything
    # extracted from the document (the form field is the authoritative source).
    resolved_consignment_ref = consignment_reference or (
        invoice_data.get("consignment_reference") if isinstance(invoice_data, dict) else None
    )
    if resolved_consignment_ref is None:
        warnings.append(
            "consignment_reference_missing:flag_for_human_completion_before_hmrc_submission"
        )

    payload = CBAMDraftFromParsedInvoiceRequest(
        importer={
            "name": parsed_importer_name,
            "eori": str(parsed_importer_eori),
        },
        invoice={
            "invoice_number": parsed_invoice_number,
            "invoice_date": parsed_invoice_date,
            "origin_country": parsed_origin_country,
            "incoterm": parsed_incoterm,
            "entry_reference": parsed_entry_reference,
            "consignment_reference": resolved_consignment_ref,
            "customs_procedure_code": customs_procedure_code,
            "net_weight_kg": net_weight_kg,
            "is_temporary_admission": is_temporary_admission,
        },
        lines=parsed_lines,
        emissions=parsed_emissions,
    )
    return payload, resolved_reporting_year, resolved_reporting_quarter, warnings


def _llama_candidate_from_structured_invoice(
    rule_candidate: dict[str, object],
    llama_output,
    raw_text: str,
    layout_payload: dict[str, object] | None,
) -> dict[str, object] | None:
    if llama_output is None:
        return None

    if hasattr(llama_output, "model_dump"):
        llama_data = llama_output.model_dump()
    elif isinstance(llama_output, dict):
        llama_data = llama_output
    else:
        return None

    if not isinstance(llama_data, dict):
        return None

    line_items = llama_data.get("line_items")
    normalized_lines: list[dict[str, object]] = []
    if isinstance(line_items, list):
        for item in line_items:
            if not isinstance(item, dict):
                continue
            quantity = item.get("quantity")
            normalized_lines.append(
                {
                    "cn_code": item.get("cn_code"),
                    "description": item.get("description"),
                    "quantity": quantity,
                    "quantity_unit": "kg" if quantity is not None else None,
                    "net_mass_kg": quantity,
                }
            )

    has_signal = any(
        llama_data.get(field)
        for field in ("importer_name", "invoice_number", "invoice_date", "origin_country")
    ) or bool(normalized_lines)
    if not has_signal:
        return None

    base_importer = rule_candidate.get("importer")
    base_invoice = rule_candidate.get("invoice")
    base_importer_eori = base_importer.get("eori") if isinstance(base_importer, dict) else None
    base_incoterm = base_invoice.get("incoterm") if isinstance(base_invoice, dict) else None
    base_entry_reference = (
        base_invoice.get("entry_reference") if isinstance(base_invoice, dict) else None
    )
    evidence: list[dict[str, object]] = []

    _append_llm_evidence(evidence, field="invoice.invoice_number", value=llama_data.get("invoice_number"))
    _append_llm_evidence(evidence, field="invoice.invoice_date", value=llama_data.get("invoice_date"))
    _append_llm_evidence(evidence, field="invoice.origin_country", value=llama_data.get("origin_country"))
    for idx, line in enumerate(normalized_lines):
        _append_llm_evidence(evidence, field=f"lines[{idx}].cn_code", value=line.get("cn_code"))
        _append_llm_evidence(evidence, field=f"lines[{idx}].net_mass_kg", value=line.get("net_mass_kg"))

    return {
        "source": "llama",
        "importer": {
            "name": llama_data.get("importer_name"),
            "eori": base_importer_eori,
        },
        "invoice": {
            "invoice_number": llama_data.get("invoice_number"),
            "invoice_date": llama_data.get("invoice_date"),
            "origin_country": llama_data.get("origin_country"),
            "incoterm": base_incoterm,
            "entry_reference": base_entry_reference,
        },
        "lines": normalized_lines,
        "emissions": rule_candidate.get("emissions"),
        "structured": rule_candidate.get("structured"),
        "layout": layout_payload,
        "full_text": raw_text,
        "evidence": evidence,
    }


def _parsed_data_quality_precheck_from_payload(
    payload: CBAMDraftFromParsedInvoiceRequest,
    reporting_year: int,
    reporting_quarter: int,
) -> dict[str, object]:
    case_row: dict[str, object] = {
        "id": "draft_case",
        "importer_eori": payload.importer.eori,
        "reporting_year": reporting_year,
        "reporting_quarter": reporting_quarter,
    }

    shipment_row: dict[str, object] = {
        "id": "draft_shipment",
        "origin_country": payload.invoice.origin_country,
        "invoice_number": payload.invoice.invoice_number or payload.invoice.entry_reference,
        "entry_reference": payload.invoice.entry_reference,
        "incoterm": payload.invoice.incoterm,
    }

    goods_payload: list[dict[str, object]] = []
    for idx, line in enumerate(payload.lines):
        goods_line = {
            "id": f"draft_goods_{idx}",
            "cn_code": line.cn_code,
            "quantity": _coerce_float(line.quantity, "quantity"),
            "net_mass_kg": _coerce_float(line.net_mass_kg, "net_mass_kg"),
            "installation_id": None,
        }
        latest_emissions = None
        if (
            line.method is not None
            or line.direct_embedded_kgco2e is not None
            or line.indirect_embedded_kgco2e is not None
        ):
            latest_emissions = {
                "method": line.method.value if line.method is not None else None,
                "direct_embedded_kgco2e": _coerce_float(
                    line.direct_embedded_kgco2e, "direct_embedded_kgco2e"
                ),
                "indirect_embedded_kgco2e": _coerce_float(
                    line.indirect_embedded_kgco2e, "indirect_embedded_kgco2e"
                ),
            }
        elif payload.emissions is not None:
            latest_emissions = {
                "method": (
                    payload.emissions.method.value
                    if payload.emissions.method is not None
                    else None
                ),
                "direct_embedded_kgco2e": _coerce_float(
                    payload.emissions.direct_embedded_kgco2e,
                    "direct_embedded_kgco2e",
                ),
                "indirect_embedded_kgco2e": _coerce_float(
                    payload.emissions.indirect_embedded_kgco2e,
                    "indirect_embedded_kgco2e",
                ),
            }

        goods_payload.append({"goods_line": goods_line, "latest_emissions": latest_emissions})

    shipments_payload = [{"shipment": shipment_row, "goods_lines": goods_payload}]
    return evaluate_cbam_data_quality(case_row, shipments_payload)


def _insert_returning(
    conn: Connection,
    table_name: str,
    payload: dict[str, object],
) -> dict[str, object]:
    cols = ", ".join(payload.keys())
    vals = ", ".join(f":{name}" for name in payload)
    row = conn.execute(
        text(f"INSERT INTO cbam.{table_name} ({cols}) VALUES ({vals}) RETURNING *"),
        payload,
    ).mappings().one()
    return dict(row)


def _build_case_summary(conn: Connection, case_id: UUID) -> dict[str, object]:
    shipments_cols = _table_columns(conn, "cbam_shipments")
    goods_cols = _table_columns(conn, "cbam_goods_lines")
    emissions_cols = _table_columns(conn, "cbam_emissions")

    case_fk_column = _pick_existing(shipments_cols, ["cbam_case_id", "case_id"])
    if not case_fk_column:
        raise HTTPException(status_code=500, detail="Internal server error")

    net_mass_col = _pick_existing(goods_cols, ["net_mass_kg", "quantity"])
    if not net_mass_col:
        raise HTTPException(status_code=500, detail="Internal server error")

    direct_col = _pick_existing(
        emissions_cols,
        ["direct_kgco2e", "direct_emissions_kgco2e", "direct_embedded_kgco2e"],
    )
    indirect_col = _pick_existing(
        emissions_cols,
        ["indirect_kgco2e", "indirect_emissions_kgco2e", "indirect_embedded_kgco2e"],
    )
    if not direct_col or not indirect_col:
        raise HTTPException(status_code=500, detail="Internal server error")

    summary = conn.execute(
        text(
            f"""
            WITH latest_emissions AS (
                SELECT e.goods_line_id,
                       e.{direct_col} AS direct_emissions,
                       e.{indirect_col} AS indirect_emissions
                FROM cbam.cbam_emissions e
                INNER JOIN (
                    SELECT goods_line_id, MAX(version) AS max_version
                    FROM cbam.cbam_emissions
                    GROUP BY goods_line_id
                ) mx
                    ON mx.goods_line_id = e.goods_line_id
                   AND mx.max_version = e.version
            )
            SELECT
                COUNT(gl.id) AS total_goods_lines,
                COALESCE(SUM(gl.{net_mass_col}), 0) AS total_net_mass_kg,
                COALESCE(SUM(le.direct_emissions), 0) AS total_direct_emissions_kgco2e,
                COALESCE(SUM(le.indirect_emissions), 0) AS total_indirect_emissions_kgco2e
            FROM cbam.cbam_goods_lines gl
            INNER JOIN cbam.cbam_shipments s ON s.id = gl.shipment_id
            LEFT JOIN latest_emissions le ON le.goods_line_id = gl.id
            WHERE s.{case_fk_column} = :case_id
            """
        ),
        {"case_id": str(case_id)},
    ).mappings().one()

    direct = Decimal(summary["total_direct_emissions_kgco2e"] or 0)
    indirect = Decimal(summary["total_indirect_emissions_kgco2e"] or 0)

    return {
        "case_id": str(case_id),
        "total_goods_lines": int(summary["total_goods_lines"] or 0),
        "total_net_mass_kg": Decimal(summary["total_net_mass_kg"] or 0),
        "total_direct_emissions_kgco2e": direct,
        "total_indirect_emissions_kgco2e": indirect,
        "total_embedded_emissions_kgco2e": direct + indirect,
    }


def _build_case_shipments_payload(conn: Connection, case_id: UUID) -> list[dict[str, object]]:
    shipments_cols = _table_columns(conn, "cbam_shipments")
    goods_cols = _table_columns(conn, "cbam_goods_lines")
    emissions_cols = _table_columns(conn, "cbam_emissions")

    case_fk_column = _pick_existing(shipments_cols, ["cbam_case_id", "case_id"])
    if not case_fk_column:
        raise HTTPException(status_code=500, detail="Internal server error")

    shipment_order_by = (
        "created_at ASC, id ASC" if "created_at" in shipments_cols else "id ASC"
    )
    shipment_rows = conn.execute(
        text(
            f"""
            SELECT *
            FROM cbam.cbam_shipments
            WHERE {case_fk_column} = :case_id
            ORDER BY {shipment_order_by}
            """
        ),
        {"case_id": str(case_id)},
    ).mappings().all()

    goods_order_by = (
        "created_at ASC, id ASC" if "created_at" in goods_cols else "id ASC"
    )
    emissions_order_by_parts: list[str] = ["version DESC"]
    if "created_at" in emissions_cols:
        emissions_order_by_parts.append("created_at DESC")
    emissions_order_by_parts.append("id DESC")
    emissions_order_by = ", ".join(emissions_order_by_parts)

    shipments_payload: list[dict[str, object]] = []
    for shipment_row in shipment_rows:
        shipment = dict(shipment_row)
        goods_rows = conn.execute(
            text(
                f"""
                SELECT *
                FROM cbam.cbam_goods_lines
                WHERE shipment_id = :shipment_id
                ORDER BY {goods_order_by}
                """
            ),
            {"shipment_id": str(shipment["id"])},
        ).mappings().all()

        goods_payload: list[dict[str, object]] = []
        for goods_line_row in goods_rows:
            goods_line = dict(goods_line_row)
            emissions_rows = conn.execute(
                text(
                    f"""
                    SELECT *
                    FROM cbam.cbam_emissions
                    WHERE goods_line_id = :goods_line_id
                    ORDER BY {emissions_order_by}
                    LIMIT 1
                    """
                ),
                {"goods_line_id": str(goods_line["id"])},
            ).mappings().all()
            latest_emissions = dict(emissions_rows[0]) if emissions_rows else None
            if latest_emissions is not None:
                # Normalize Supabase short column names to canonical keys used
                # throughout compliance_pack, eu_xml_builder, and report_validator.
                # cbam_emissions stores direct_kgco2e / indirect_kgco2e;
                # downstream code expects direct_embedded_kgco2e / indirect_embedded_kgco2e.
                if "direct_kgco2e" in latest_emissions and "direct_embedded_kgco2e" not in latest_emissions:
                    latest_emissions["direct_embedded_kgco2e"] = latest_emissions["direct_kgco2e"]
                if "indirect_kgco2e" in latest_emissions and "indirect_embedded_kgco2e" not in latest_emissions:
                    latest_emissions["indirect_embedded_kgco2e"] = latest_emissions["indirect_kgco2e"]
            goods_payload.append(
                {
                    "goods_line": goods_line,
                    "latest_emissions": latest_emissions,
                }
            )

        shipments_payload.append(
            {
                "shipment": shipment,
                "goods_lines": goods_payload,
            }
        )

    return shipments_payload
