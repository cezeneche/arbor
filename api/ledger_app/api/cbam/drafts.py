from __future__ import annotations

import os
import re
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import datetime
import logging
import threading

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import JSONResponse

_log = logging.getLogger(__name__)
from sqlalchemy import text

from ledger_app.services.cbam_arbiter import validate_consignment_consistency
from ledger_app.services.cbam_emissions_selector import select_and_calculate
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from shared_auth import require_scopes

from . import _shared


def _friendly_error(msg: str) -> str:
    if "cbam_cases_unique_period" in msg or (
        "UniqueViolation" in msg and "importer_eori" in msg
    ):
        m = re.search(
            r"reporting_year, reporting_quarter\)=\([^,]+,\s*([^,]+),\s*(\d+),\s*(\d+)\)",
            msg,
        )
        if m:
            eori, year, quarter = m.group(1).strip(), m.group(2), m.group(3)
            return f"A case for importer {eori} already exists for Q{quarter} {year}."
        return "A case for this importer already exists for this reporting period."
    if "UniqueViolation" in msg or "duplicate key" in msg:
        return "This record already exists. Please check for duplicates before submitting."
    if "No invoice lines" in msg or "No goods lines" in msg:
        return "No goods lines were found in this document. Check that the invoice includes line items with CN codes."
    if "Extractor returned no" in msg or "Extractor returned an invalid" in msg:
        return "Nothing could be extracted from this document. Check the file contains invoice data."
    if "reporting_quarter must be between" in msg:
        return "The reporting quarter could not be determined from the document. Check the invoice date."
    if "pipeline_timeout" in msg:
        return "Processing timed out. The document may be too large. Try a shorter document or contact support."
    return msg


_VALIDATION_FIELD_LABELS: dict[str, str] = {
    "importer.eori": "EORI number",
    "invoice.invoice_date": "invoice date",
    "lines": "goods lines",
    "lines.cn_code": "CN code",
}

_VALIDATION_TYPE_LABELS: dict[str, str] = {
    "string_too_short": "is missing",
    "missing": "is missing",
    "too_short": "is missing",
    "date_from_datetime_parsing": "is not a valid date",
    "value_error": "is invalid",
}


def _humanize_validation_error(exc: ValidationError) -> str:
    messages: list[str] = []
    for err in exc.errors():
        loc = ".".join(str(p) for p in err.get("loc", []) if not isinstance(p, int))
        label = _VALIDATION_FIELD_LABELS.get(loc) or loc.replace("_", " ").replace(".", " ")
        if label == "goods lines":
            messages.append("No goods lines were found.")
        else:
            type_label = _VALIDATION_TYPE_LABELS.get(err.get("type", ""), "is invalid")
            messages.append(f"The {label} {type_label}.")
    return " ".join(messages) if messages else "The document is missing required fields."

router = APIRouter()

# Prompt version — bump when the LLM extraction prompt template is changed.
# Captured in the extraction_v1 snapshot model_versions so auditors can trace
# which prompt produced a given extraction.
_EXTRACTION_PROMPT_VERSION = "v1"


def _create_cbam_draft_from_parsed_invoice_payload(
    payload: _shared.CBAMDraftFromParsedInvoiceRequest,
    reporting_year_override: int | None = None,
    reporting_quarter_override: int | None = None,
    warn_on_missing_emissions: bool = False,
    tenant_id: str = "",
    existing_case_id: str | None = None,
) -> dict[str, object]:
    with _shared.engine.begin() as conn:
        case_columns = _shared._table_columns(conn, "cbam_cases")
        _shared._enforce_tenant_id(case_columns, tenant_id)
        _shared.set_tenant_context(conn, tenant_id)
        shipment_columns = _shared._table_columns(conn, "cbam_shipments")
        goods_columns = _shared._table_columns(conn, "cbam_goods_lines")
        emissions_columns = _shared._table_columns(conn, "cbam_emissions")

        reporting_year = (
            reporting_year_override
            if reporting_year_override is not None
            else payload.invoice.invoice_date.year
        )
        reporting_quarter = (
            reporting_quarter_override
            if reporting_quarter_override is not None
            else _shared._quarter_from_date(payload.invoice.invoice_date)
        )
        warnings: list[str] = []

        if existing_case_id:
            # Async upload path — stub case already created with status="processing".
            # Before updating, check whether another case already owns this period.
            tenant_filter = (
                "AND tenant_id = :tenant_id" if (tenant_id and "tenant_id" in case_columns) else ""
            )
            conflict_params: dict[str, object] = {
                "importer_eori": payload.importer.eori,
                "reporting_year": reporting_year,
                "reporting_quarter": reporting_quarter,
                "stub_id": existing_case_id,
            }
            if tenant_id and "tenant_id" in case_columns:
                conflict_params["tenant_id"] = tenant_id
            conflict_row = conn.execute(
                text(
                    f"""
                    SELECT id FROM cbam.cbam_cases
                    WHERE importer_eori = :importer_eori
                      AND reporting_year = :reporting_year
                      AND reporting_quarter = :reporting_quarter
                      AND id != :stub_id
                      {tenant_filter}
                    LIMIT 1
                    """
                ),
                conflict_params,
            ).mappings().one_or_none()
            if conflict_row:
                # Delete the stub and surface a clear error — do not leave orphaned processing cases.
                conn.execute(
                    text("DELETE FROM cbam.cbam_cases WHERE id = :id"),
                    {"id": existing_case_id},
                )
                raise IntegrityError(
                    statement=None,
                    params=None,
                    orig=Exception("cbam_cases_unique_period"),
                )

            case_id = existing_case_id
            update_fields: dict[str, object] = {
                "id": case_id,
                "importer_eori": payload.importer.eori,
                "reporting_year": reporting_year,
                "reporting_quarter": reporting_quarter,
            }
            if "importer_name" in case_columns:
                update_fields["importer_name"] = payload.importer.name or payload.importer.eori
            if "status" in case_columns:
                update_fields["status"] = "draft"
            set_clause = ", ".join(
                f"{k} = :{k}" for k in update_fields if k != "id"
            )
            conn.execute(
                text(f"UPDATE cbam.cbam_cases SET {set_clause} WHERE id = :id"),
                update_fields,
            )
        else:
            # Synchronous path — look for or create the case normally.
            tenant_case_filter = (
                "AND tenant_id = :tenant_id" if (tenant_id and "tenant_id" in case_columns) else ""
            )
            case_lookup_params: dict[str, object] = {
                "importer_eori": payload.importer.eori,
                "reporting_year": reporting_year,
                "reporting_quarter": reporting_quarter,
            }
            if tenant_case_filter:
                case_lookup_params["tenant_id"] = tenant_id

            existing_case_rows = conn.execute(
                text(
                    f"""
                    SELECT *
                    FROM cbam.cbam_cases
                    WHERE importer_eori = :importer_eori
                      AND reporting_year = :reporting_year
                      AND reporting_quarter = :reporting_quarter
                      {tenant_case_filter}
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                ),
                case_lookup_params,
            ).mappings().all()

            if existing_case_rows:
                case_id = str(existing_case_rows[0]["id"])
            else:
                case_insert: dict[str, object] = {
                    "id": str(uuid4()),
                    "importer_eori": payload.importer.eori,
                    "reporting_year": reporting_year,
                    "reporting_quarter": reporting_quarter,
                }
                if "importer_name" in case_columns:
                    case_insert["importer_name"] = payload.importer.name or payload.importer.eori
                if "status" in case_columns:
                    case_insert["status"] = "draft"
                if "tenant_id" in case_columns:
                    case_insert["tenant_id"] = tenant_id

                case_row = _shared._insert_returning(conn, "cbam_cases", case_insert)
                case_id = str(case_row["id"])

        case_fk_column = _shared._pick_existing(shipment_columns, ["cbam_case_id", "case_id"])
        if not case_fk_column:
            raise HTTPException(status_code=500, detail="Internal server error")

        invoice_number = payload.invoice.invoice_number
        matched_shipment: dict[str, object] | None = None
        if invoice_number:
            shipment_order_by = "created_at DESC, id DESC" if "created_at" in shipment_columns else "id DESC"
            existing_shipments = conn.execute(
                text(
                    f"""
                    SELECT *
                    FROM cbam.cbam_shipments
                    WHERE {case_fk_column} = :case_id
                    ORDER BY {shipment_order_by}
                    """
                ),
                {"case_id": case_id},
            ).mappings().all()

            for row in existing_shipments:
                shipment = dict(row)
                if "invoice_number" in shipment_columns and shipment.get("invoice_number") == invoice_number:
                    matched_shipment = shipment
                    break
                if shipment.get("entry_reference") == invoice_number:
                    matched_shipment = shipment
                    break

        if matched_shipment is not None:
            shipment_id = str(matched_shipment["id"])
            warnings.append(
                f"Reused existing shipment for invoice_number={invoice_number}."
            )
        else:
            shipment_insert: dict[str, object] = {
                "id": str(uuid4()),
                case_fk_column: case_id,
            }

            if "tenant_id" in shipment_columns:
                shipment_insert["tenant_id"] = tenant_id

            if "origin_country" in shipment_columns:
                shipment_insert["origin_country"] = payload.invoice.origin_country
            if "incoterm" in shipment_columns:
                shipment_insert["incoterm"] = payload.invoice.incoterm
            if "invoice_number" in shipment_columns:
                shipment_insert["invoice_number"] = payload.invoice.invoice_number
            if "entry_reference" in shipment_columns:
                shipment_insert["entry_reference"] = (
                    payload.invoice.invoice_number
                    if payload.invoice.invoice_number
                    else payload.invoice.entry_reference
                )
            if _shared._needs_explicit_value(shipment_columns, "import_date") or "import_date" in shipment_columns:
                shipment_insert["import_date"] = payload.invoice.invoice_date
            # UK HMRC consignment fields (migration 008)
            if "consignment_reference" in shipment_columns:
                shipment_insert["consignment_reference"] = payload.invoice.consignment_reference
            if "customs_procedure_code" in shipment_columns:
                shipment_insert["customs_procedure_code"] = payload.invoice.customs_procedure_code
            if "net_weight_kg" in shipment_columns and payload.invoice.net_weight_kg is not None:
                shipment_insert["net_weight_kg"] = payload.invoice.net_weight_kg
            if "is_temporary_admission" in shipment_columns:
                shipment_insert["is_temporary_admission"] = payload.invoice.is_temporary_admission

            shipment_row = _shared._insert_returning(conn, "cbam_shipments", shipment_insert)
            shipment_id = str(shipment_row["id"])

        # Temporary admission exemption warning
        if payload.invoice.is_temporary_admission:
            warnings.append(
                "consignment_temporary_admission:exempt_from_cbam_liability"
            )

        # Cross-consignment consistency check: query all shipments for this
        # case that carry a consignment_reference and validate origin_country /
        # import_date are uniform within each reference group.
        if "consignment_reference" in shipment_columns:
            try:
                sibling_rows = conn.execute(
                    text(
                        """
                        SELECT consignment_reference, origin_country, import_date
                        FROM cbam.cbam_shipments
                        WHERE case_id = :case_id
                          AND consignment_reference IS NOT NULL
                        """
                    ),
                    {"case_id": case_id},
                ).mappings().all()
                consistency_warnings = validate_consignment_consistency(
                    [dict(r) for r in sibling_rows]
                )
                warnings.extend(consistency_warnings)
            except Exception:
                pass  # non-fatal — DB may not yet have the column (pre-migration)

        direct_col = _shared._pick_existing(
            emissions_columns, ["direct_kgco2e", "direct_emissions_kgco2e", "direct_embedded_kgco2e"]
        )
        indirect_col = _shared._pick_existing(
            emissions_columns, ["indirect_kgco2e", "indirect_emissions_kgco2e", "indirect_embedded_kgco2e"]
        )
        method_col = _shared._pick_existing(emissions_columns, ["calculation_method", "method"])
        goods_line_fk_column = _shared._pick_existing(emissions_columns, ["goods_line_id"])

        goods_order_by = "created_at ASC, id ASC" if "created_at" in goods_columns else "id ASC"
        existing_goods_rows = conn.execute(
            text(
                f"""
                SELECT *
                FROM cbam.cbam_goods_lines
                WHERE shipment_id = :shipment_id
                ORDER BY {goods_order_by}
                """
            ),
            {"shipment_id": shipment_id},
        ).mappings().all()
        existing_goods_by_fp: dict[tuple[str, str, str, str], str] = {}
        description_col = "product_description" if "product_description" in goods_columns else "description"
        mass_col = "net_mass_kg" if "net_mass_kg" in goods_columns else "quantity"
        for row in existing_goods_rows:
            fp = _shared._line_fingerprint(
                row.get("cn_code"),
                row.get(description_col),
                row.get(mass_col),
                row.get("quantity_unit"),
            )
            if fp not in existing_goods_by_fp:
                existing_goods_by_fp[fp] = str(row["id"])

        goods_line_ids: list[str] = []
        emissions_ids: list[str] = []

        for line in payload.lines:
            line_quantity = _shared._coerce_float(line.quantity, "quantity")
            line_net_mass = _shared._coerce_float(line.net_mass_kg, "net_mass_kg")
            line_mass = line_net_mass if line_net_mass is not None else line_quantity
            line_unit = line.quantity_unit or "kg"
            line_fp = _shared._line_fingerprint(
                line.cn_code,
                line.description,
                line_mass,
                line_unit,
            )

            if line_fp in existing_goods_by_fp:
                goods_line_id = existing_goods_by_fp[line_fp]
                warnings.append(f"goods_line_reused:{line.cn_code}")
            else:
                goods_insert: dict[str, object] = {
                    "id": str(uuid4()),
                    "shipment_id": shipment_id,
                    "cn_code": line.cn_code,
                }

                if "tenant_id" in goods_columns:
                    goods_insert["tenant_id"] = tenant_id

                if "product_description" in goods_columns:
                    goods_insert["product_description"] = line.description
                elif "description" in goods_columns:
                    goods_insert["description"] = line.description

                if "net_mass_kg" in goods_columns:
                    mass = line_net_mass if line_net_mass is not None else line_quantity
                    if mass is None:
                        mass = Decimal("0")
                        warnings.append(
                            f"No quantity or net_mass_kg provided for cn_code={line.cn_code}; defaulted net_mass_kg to 0."
                        )
                    goods_insert["net_mass_kg"] = mass
                elif "quantity" in goods_columns:
                    quantity = line_quantity if line_quantity is not None else line_net_mass
                    if quantity is None:
                        quantity = Decimal("0")
                        warnings.append(
                            f"No quantity or net_mass_kg provided for cn_code={line.cn_code}; defaulted quantity to 0."
                        )
                    goods_insert["quantity"] = quantity
                    if "quantity_unit" in goods_columns:
                        goods_insert["quantity_unit"] = line.quantity_unit or "kg"

                if "quantity_unit" in goods_columns and "quantity_unit" not in goods_insert:
                    goods_insert["quantity_unit"] = line.quantity_unit or "kg"

                if _shared._needs_explicit_value(goods_columns, "sector") or "sector" in goods_columns:
                    try:
                        goods_insert["sector"] = _shared._infer_sector_from_cn_code(line.cn_code)
                    except _shared.CBAMCodeNotInScope:
                        warnings.append(
                            f"cbam_scope:cn_not_in_scope:{line.cn_code} — "
                            f"not covered by EU Regulation 2023/956 Annex I; "
                            f"goods line skipped"
                        )
                        continue

                goods_row = _shared._insert_returning(conn, "cbam_goods_lines", goods_insert)
                goods_line_id = str(goods_row["id"])
                existing_goods_by_fp[line_fp] = goods_line_id

            goods_line_ids.append(goods_line_id)

            emissions_payload = payload.emissions
            line_direct_source = (
                line.direct_embedded_kgco2e
                if line.direct_embedded_kgco2e is not None
                else (emissions_payload.direct_embedded_kgco2e if emissions_payload else None)
            )
            line_indirect_source = (
                line.indirect_embedded_kgco2e
                if line.indirect_embedded_kgco2e is not None
                else (emissions_payload.indirect_embedded_kgco2e if emissions_payload else None)
            )
            line_method_declared = line.method if line.method is not None else (
                emissions_payload.method if emissions_payload else None
            )

            if direct_col and indirect_col and method_col and goods_line_fk_column:
                existing_line_emissions = conn.execute(
                    text(
                        """
                        SELECT *
                        FROM cbam.cbam_emissions
                        WHERE goods_line_id = :goods_line_id
                        ORDER BY version DESC, id DESC
                        """
                    ),
                    {"goods_line_id": goods_line_id},
                ).mappings().all()
                existing_same_version = next(
                    (row for row in existing_line_emissions if int(row.get("version") or 0) == 1),
                    None,
                )
                if existing_same_version is not None:
                    emissions_ids.append(str(existing_same_version["id"]))
                    warnings.append(f"emissions_reused:{goods_line_id}")
                    continue

                # ── Automated method selection (EU 2023/1773 Art. 4) ──────────
                # Determines actual / estimated / default and computes direct +
                # indirect kgCO2e values.  Always runs — even when the caller
                # supplies a method and values, the selector validates them.
                mass_for_selector = Decimal(str(
                    goods_insert.get("net_mass_kg") or goods_insert.get("quantity") or 0
                )) if "net_mass_kg" in goods_insert or "quantity" in goods_insert else Decimal("0")

                sel = select_and_calculate(
                    cn_code=line.cn_code,
                    net_mass_kg=mass_for_selector,
                    direct_kgco2e_supplier=line_direct_source,
                    indirect_kgco2e_supplier=line_indirect_source,
                    force_method=line_method_declared.value if line_method_declared else None,
                )

                warnings.extend(sel.warnings)

                emissions_insert: dict[str, object] = {
                    "id": str(uuid4()),
                    goods_line_fk_column: goods_line_id,
                    direct_col: sel.direct_kgco2e,
                    indirect_col: sel.indirect_kgco2e,
                    method_col: sel.method,
                    "version": 1,
                }

                if "tenant_id" in emissions_columns:
                    emissions_insert["tenant_id"] = tenant_id
                emissions_row = _shared._insert_returning(conn, "cbam_emissions", emissions_insert)
                emissions_ids.append(str(emissions_row["id"]))

        return {
            "case_id": case_id,
            "shipment_id": shipment_id,
            "goods_line_ids": goods_line_ids,
            "emissions_ids": emissions_ids,
            "warnings": warnings,
        }


@router.post(
    "/drafts/from-parsed-invoice",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scopes(["cbam:write"]))],
)
def create_cbam_draft_from_parsed_invoice(
    request: Request,
    payload: _shared.CBAMDraftFromParsedInvoiceRequest,
):
    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")
    try:
        return _create_cbam_draft_from_parsed_invoice_payload(payload, tenant_id=tenant_id)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=_humanize_validation_error(exc))
    except IntegrityError as exc:
        orig = str(exc.orig) if exc.orig else str(exc)
        if "cbam_cases_unique_period" in orig:
            detail = "A case for this EORI, year, and quarter already exists. Open the existing case to continue."
        else:
            detail = "This record already exists. Please check for duplicates before submitting."
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _extract_consignment_ref_from_xml(data: bytes, content_type: str | None) -> str | None:
    """
    Try to extract an ENS number, MRN, or customs entry reference from a
    customs declaration XML file.

    Handles HMRC CDS (movementReferenceNumber / MRN), ICS2 ENS, and generic
    WCO-DMS element names.  Returns None when the file is not XML, cannot be
    parsed, or contains no recognisable reference element.
    """
    _xml_content_types = {"text/xml", "application/xml", "application/x-xml"}
    _xml_byte_prefixes = (b"<?xml", b"<Declaration", b"<GoodsShipment", b"<ns2:", b"<ns:")
    lstripped = data.lstrip()
    is_xml = (content_type or "").lower().split(";")[0].strip() in _xml_content_types or any(
        lstripped.startswith(sig) for sig in _xml_byte_prefixes
    )
    if not is_xml:
        return None

    try:
        import defusedxml.ElementTree as ET  # already in requirements
        root = ET.fromstring(data)
    except Exception:
        return None

    # Namespace-agnostic: compare local name in lower-case.
    # Covers HMRC CDS, ICS2, and generic WCO-DMS vocabularies.
    _target_locals = frozenset({
        "mrn",
        "movementreferencenumber",
        "declarationid",
        "entrynumber",
        "entryreference",
        "ensnumber",
        "referencenumber",
        "declarationreference",
        "ens",
    })
    for el in root.iter():
        local = (el.tag.split("}")[-1] if "}" in el.tag else el.tag).lower()
        if local in _target_locals and el.text:
            val = el.text.strip()
            if 1 <= len(val) <= 50:
                return val
    return None


def _create_stub_processing_case(tenant_id: str) -> str:
    """Insert a minimal case row with status='processing'. Returns the new case_id."""
    now = datetime.datetime.now(datetime.timezone.utc)
    quarter = (now.month - 1) // 3 + 1
    with _shared.engine.begin() as conn:
        case_columns = _shared._table_columns(conn, "cbam_cases")
        _shared.set_tenant_context(conn, tenant_id)
        # Use a UUID-based placeholder so the unique (tenant, eori, year, quarter)
        # constraint never blocks a second upload attempt while the first is processing.
        stub: dict[str, object] = {
            "id":                str(uuid4()),
            "importer_eori":     f"__stub_{uuid4().hex[:12]}",
            "reporting_year":    now.year,
            "reporting_quarter": quarter,
        }
        if "status"           in case_columns: stub["status"]           = "processing"
        if "processing_stage" in case_columns: stub["processing_stage"] = "uploading"
        if "tenant_id"        in case_columns: stub["tenant_id"]        = tenant_id
        row = _shared._insert_returning(conn, "cbam_cases", stub)
        return str(row["id"])


def _set_stage(case_id: str, tenant_id: str, stage: str) -> None:
    """Update processing_stage on the case row so the frontend can show real progress."""
    try:
        with _shared.engine.begin() as conn:
            cols = _shared._table_columns(conn, "cbam_cases")
            if "processing_stage" not in cols:
                return
            _shared.set_tenant_context(conn, tenant_id)
            tenant_filter = "AND tenant_id = :tenant_id" if "tenant_id" in cols else ""
            conn.execute(
                text(
                    f"UPDATE cbam.cbam_cases SET processing_stage = :stage"
                    f" WHERE id = :id {tenant_filter}"
                ),
                {"stage": stage, "id": case_id, "tenant_id": tenant_id},
            )
    except Exception:
        pass


# Safety net: if the pipeline hangs (e.g. OCR model stall, network hang), this
# timer marks the case as error so the frontend poll resolves. Set generously
# above the realistic pipeline ceiling — not an artificial speed cap.
_PIPELINE_TIMEOUT_SECONDS = int(os.getenv("PIPELINE_TIMEOUT_SECONDS", "180"))


def _run_document_pipeline(
    case_id:               str,
    file_bytes:            bytes,
    filename:              str,
    content_type:          str | None,
    tenant_id:             str,
    document_sha256:       str,
    run_id:                str | None,
    importer_name:         str | None,
    importer_eori:         str | None,
    reporting_year:        int | None,
    reporting_quarter:     int | None,
    consignment_reference: str | None,
    customs_procedure_code: str | None,
    is_temporary_admission: bool,
) -> None:
    """Run extraction + CBAM creation in the background. Updates case_id on success/error."""
    from ledger_app.core.version import APP_GIT_SHA, APP_VERSION
    from app.services.notifications import notify_pipeline_error

    def _mark_error(msg: str) -> None:
        clean = _friendly_error(msg)
        try:
            with _shared.engine.begin() as conn:
                cols = _shared._table_columns(conn, "cbam_cases")
                _shared.set_tenant_context(conn, tenant_id)
                extra = ""
                params: dict = {"id": case_id}
                if "processing_error" in cols:
                    extra += ", processing_error = :err"
                    params["err"] = clean[:2000]
                if "processing_stage" in cols:
                    extra += ", processing_stage = :stage"
                    params["stage"] = "failed"
                conn.execute(
                    text(f"UPDATE cbam.cbam_cases SET status = 'error'{extra} WHERE id = :id"),
                    params,
                )
        except Exception as db_exc:
            _log.error("[pipeline] _mark_error DB write failed for case %s: %s", case_id, db_exc)
        notify_pipeline_error(
            stage="document_parsing",
            error_message=clean,
            case_id=case_id,
            filename=filename,
        )
        _log.error("[pipeline] case %s failed: %s", case_id, msg)

    _deadline = threading.Timer(
        _PIPELINE_TIMEOUT_SECONDS,
        _mark_error,
        args=(f"pipeline_timeout_after_{_PIPELINE_TIMEOUT_SECONDS}s",),
    )
    _deadline.daemon = True
    _deadline.start()

    try:
        _run_document_pipeline_inner(
            case_id=case_id,
            file_bytes=file_bytes,
            filename=filename,
            content_type=content_type,
            tenant_id=tenant_id,
            document_sha256=document_sha256,
            run_id=run_id,
            importer_name=importer_name,
            importer_eori=importer_eori,
            reporting_year=reporting_year,
            reporting_quarter=reporting_quarter,
            consignment_reference=consignment_reference,
            customs_procedure_code=customs_procedure_code,
            is_temporary_admission=is_temporary_admission,
            mark_error=_mark_error,
            APP_GIT_SHA=APP_GIT_SHA,
            APP_VERSION=APP_VERSION,
        )
    except Exception as exc:
        _mark_error(str(exc))
    finally:
        _deadline.cancel()


def _run_document_pipeline_inner(
    case_id:               str,
    file_bytes:            bytes,
    filename:              str,
    content_type:          str | None,
    tenant_id:             str,
    document_sha256:       str,
    run_id:                str | None,
    importer_name:         str | None,
    importer_eori:         str | None,
    reporting_year:        int | None,
    reporting_quarter:     int | None,
    consignment_reference: str | None,
    customs_procedure_code: str | None,
    is_temporary_admission: bool,
    mark_error,
    APP_GIT_SHA:           str,
    APP_VERSION:           str,
) -> None:
    def _mark_error(msg: str) -> None:  # type: ignore[no-redef]
        return mark_error(msg)

    # ── XML consignment reference extraction ──────────────────────────────────
    if not consignment_reference:
        consignment_reference = _extract_consignment_ref_from_xml(file_bytes, content_type)

    # ── AI extraction ─────────────────────────────────────────────────────────
    _set_stage(case_id, tenant_id, "reading_document")
    try:
        _shared.ingest_orchestrator.extract_document_from_upload = _shared.extract_document_from_upload
        _shared.ingest_orchestrator.extract_cbam_document        = _shared.extract_cbam_document
        _shared.ingest_orchestrator.LlamaOrchestrator            = _shared.LlamaOrchestrator
        ingest_plan = _shared.ingest_orchestrator.run_document_ingest_plan(
            filename=filename, content_type=content_type, data=file_bytes,
        )
    except Exception as exc:
        _mark_error(str(exc))
        return

    raw_text        = str(ingest_plan.get("raw_text", ""))
    layout          = ingest_plan.get("layout")
    layout_payload  = layout if isinstance(layout, dict) else None
    routing_trace   = ingest_plan.get("routing_trace") or {}
    raw_candidates  = ingest_plan.get("candidates")

    if not isinstance(raw_candidates, list) or not raw_candidates:
        _mark_error("Nothing could be extracted from this document. Check the file contains invoice data.")
        return
    candidates = [c for c in raw_candidates if isinstance(c, dict)]
    if not candidates:
        _mark_error("Nothing could be extracted from this document. Check the file contains invoice data.")
        return

    # ── Arbitration + repair ──────────────────────────────────────────────────
    _set_stage(case_id, tenant_id, "extracting_fields")
    try:
        arbiter_warnings: list[str] = []
        repair_warnings:  list[str] = []
        rule_candidate  = candidates[0]
        llama_output    = routing_trace.get("llama_output")
        extraction_validation = (
            _shared.compare_extractions(rule_candidate, llama_output)
            if llama_output is not None
            else {"match_score": 100.0, "differences": []}
        )
        if len(candidates) > 1:
            arbitrated_candidate, arbiter_warnings = _shared.arbitrate_parsed_invoice(candidates)
        else:
            arbitrated_candidate, arbiter_warnings = rule_candidate, []
        repaired_candidate, repair_warnings = _shared.repair_parsed_invoice(arbitrated_candidate)
        extraction_validation.update({
            "arbiter_warnings": arbiter_warnings,
            "repair_warnings":  repair_warnings,
            "evidence":         _shared._normalized_evidence(repaired_candidate.get("evidence")),
            "fallback_sources": [],
            "gemini_fallback_used": False,
            "routing_trace":    routing_trace,
        })
    except Exception as exc:
        extraction_validation = {
            "match_score": 0.0,
            "differences": [f"ingest_orchestration_error:{exc}"],
            "evidence": [], "fallback_sources": [],
            "gemini_fallback_used": False, "routing_trace": routing_trace,
        }
        repaired_candidate  = candidates[0]
        arbitrated_candidate = candidates[0]

    # ── Build parsed invoice payload ──────────────────────────────────────────
    _set_stage(case_id, tenant_id, "refining")
    try:
        parsed_payload, resolved_year, resolved_quarter, parse_warnings = (
            _shared._build_parsed_invoice_request_from_extraction(
                extraction=repaired_candidate,
                importer_name=importer_name,
                importer_eori=importer_eori,
                reporting_year=reporting_year,
                reporting_quarter=reporting_quarter,
                consignment_reference=consignment_reference,
                customs_procedure_code=customs_procedure_code,
                is_temporary_admission=is_temporary_admission,
            )
        )
    except ValidationError as exc:
        _mark_error(_humanize_validation_error(exc))
        return
    except Exception as exc:
        _mark_error(str(exc))
        return

    try:
        dq_precheck = _shared._parsed_data_quality_precheck_from_payload(
            payload=parsed_payload,
            reporting_year=resolved_year,
            reporting_quarter=resolved_quarter,
        )
    except Exception as exc:
        _mark_error(str(exc))
        return

    extraction_validation["data_quality"] = dq_precheck

    # ── Persist: create/update case, shipments, goods lines, emissions ────────
    _set_stage(case_id, tenant_id, "saving")
    try:
        created = _create_cbam_draft_from_parsed_invoice_payload(
            parsed_payload,
            reporting_year_override=resolved_year,
            reporting_quarter_override=resolved_quarter,
            warn_on_missing_emissions=True,
            tenant_id=tenant_id,
            existing_case_id=case_id,
        )
    except IntegrityError as exc:
        _mark_error(_friendly_error(str(exc)))
        return
    except Exception as exc:
        _mark_error(str(exc))
        return

    # ── Audit snapshots ───────────────────────────────────────────────────────
    _extraction_algo = {
        "rule_extractor": "v1", "layout": "v1",
        "app_git_sha": APP_GIT_SHA, "app_version": APP_VERSION,
        **({"run_id": run_id} if run_id else {}),
    }
    extraction_stage_payload = {
        "document_sha256": document_sha256,
        "raw_text":        raw_text,
        "layout":          layout_payload,
        "routing_trace":   routing_trace,
        "candidates":      candidates,
        "extraction_validation": {
            "match_score":       extraction_validation.get("match_score"),
            "differences":       extraction_validation.get("differences"),
            "fallback_sources":  extraction_validation.get("fallback_sources"),
            "gemini_fallback_used": extraction_validation.get("gemini_fallback_used"),
        },
    }
    parent_hash = _shared._safe_snapshot_write(
        case_id=case_id, stage="extraction_v1",
        payload=extraction_stage_payload, parent_hash=None,
        algo_versions=_extraction_algo,
        model_versions={
            "llama": str(os.getenv("LLAMA_STRUCTURED_MODEL", "unknown")),
            "extraction_prompt": _EXTRACTION_PROMPT_VERSION,
        },
    )
    _shared._write_audit_event(case_id, "cbam_extracted", {
        "document_sha256":    document_sha256,
        "snapshot_hash":      parent_hash,
        "candidates_count":   len(candidates),
        "run_id":             run_id,
    }, tenant_id=tenant_id)
    parent_hash = _shared._safe_snapshot_write(
        case_id=case_id, stage="arbitrated_v1",
        payload=arbitrated_candidate, parent_hash=parent_hash,
        algo_versions={"arbiter": "v1", "app_git_sha": APP_GIT_SHA, **({"run_id": run_id} if run_id else {})},
    )
    _shared._safe_snapshot_write(
        case_id=case_id, stage="repaired_v1",
        payload=repaired_candidate, parent_hash=parent_hash,
        algo_versions={"repair": "v1", "app_git_sha": APP_GIT_SHA, **({"run_id": run_id} if run_id else {})},
    )
    _log.info("[pipeline] case %s completed — %d goods lines", case_id, len(created.get("goods_line_ids", [])))


@router.post(
    "/drafts/from-document",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scopes(["cbam:write"]))],
)
async def create_cbam_draft_from_document(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    importer_name: str | None = Form(default=None),
    importer_eori: str | None = Form(default=None),
    reporting_year: int | None = Form(default=None),
    reporting_quarter: int | None = Form(default=None),
    consignment_reference: str | None = Form(default=None),
    customs_procedure_code: str | None = Form(default=None),
    is_temporary_admission: bool = Form(default=False),
):
    if not file.filename:
        return JSONResponse(
            status_code=422,
            content={"detail": "File name is required.", "stage": "extract"},
        )

    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")
    safe_filename = Path(file.filename).name or "upload.bin"
    run_id: str | None = getattr(request.state, "request_id", None)

    # Read bytes during request — UploadFile stream is unavailable after response
    file_bytes = await file.read()
    document_sha256 = _shared.bytes_sha256_hex(file_bytes)

    # Create a stub case immediately so the client can navigate to it while
    # extraction runs in the background.
    try:
        case_id = _create_stub_processing_case(tenant_id)
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"detail": str(exc), "stage": "create"},
        )

    background_tasks.add_task(
        _run_document_pipeline,
        case_id=case_id,
        file_bytes=file_bytes,
        filename=safe_filename,
        content_type=file.content_type,
        tenant_id=tenant_id,
        document_sha256=document_sha256,
        run_id=run_id,
        importer_name=importer_name,
        importer_eori=importer_eori,
        reporting_year=reporting_year,
        reporting_quarter=reporting_quarter,
        consignment_reference=consignment_reference,
        customs_procedure_code=customs_procedure_code,
        is_temporary_admission=is_temporary_admission,
    )

    return {
        "created": {
            "case_id":       case_id,
            "shipment_id":   None,
            "goods_line_ids": [],
            "emissions_ids": [],
            "warnings":      [],
        },
        "warnings":        [],
        "document_sha256": document_sha256,
    }
