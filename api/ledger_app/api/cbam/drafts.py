from __future__ import annotations

import os
import re
from decimal import Decimal
from uuid import uuid4

import datetime
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
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
                    reporting_year=reporting_year,
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

    # Record the arbitrated snapshot the audit trail reads from.
    #
    # Nucleos used to write this at the end of its own document pipeline. Arbor
    # owns document→text from Phase 2 and produces the evidence, so it arrives in
    # the payload instead. Skipping the write when no evidence was supplied keeps
    # a caller that has none from appending an empty snapshot that would read as
    # "we looked and found nothing".
    evidence = _shared._normalized_evidence(getattr(payload, "evidence", None))
    if evidence:
        snapshot_payload = {
            "importer": payload.importer.model_dump(mode="json"),
            "invoice": payload.invoice.model_dump(mode="json"),
            "lines": [line.model_dump(mode="json") for line in payload.lines],
            "evidence": evidence,
        }
        # Two stages, because two readers look in different places: the report
        # package's extraction_evidence block reads arbitrated_v1, and
        # explain-by-field reads repaired_v1. The old pipeline wrote a distinct
        # snapshot per stage as it progressed. Here they are the same object —
        # what arrives has already been arbitrated and repaired on the Nucleos
        # side before Arbor sent it, so there is no intermediate state to record.
        for stage in ("arbitrated_v1", "repaired_v1"):
            _shared._safe_snapshot_write(
                case_id=case_id,
                stage=stage,
                payload=snapshot_payload,
            )

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
