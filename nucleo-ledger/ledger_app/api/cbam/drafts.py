from __future__ import annotations

import os
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from . import _shared

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
) -> dict[str, object]:
    with _shared.engine.begin() as conn:
        case_columns = _shared._table_columns(conn, "cbam_cases")
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

        existing_case_rows = conn.execute(
            text(
                """
                SELECT *
                FROM cbam.cbam_cases
                WHERE importer_eori = :importer_eori
                  AND reporting_year = :reporting_year
                  AND reporting_quarter = :reporting_quarter
                ORDER BY created_at DESC
                LIMIT 1
                """
            ),
            {
                "importer_eori": payload.importer.eori,
                "reporting_year": reporting_year,
                "reporting_quarter": reporting_quarter,
            },
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

            shipment_row = _shared._insert_returning(conn, "cbam_shipments", shipment_insert)
            shipment_id = str(shipment_row["id"])

        direct_col = _shared._pick_existing(
            emissions_columns, ["direct_emissions_kgco2e", "direct_embedded_kgco2e"]
        )
        indirect_col = _shared._pick_existing(
            emissions_columns, ["indirect_emissions_kgco2e", "indirect_embedded_kgco2e"]
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
            line_method = line.method if line.method is not None else (
                emissions_payload.method if emissions_payload else None
            )
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

            if (
                line_method is not None
                and direct_col
                and indirect_col
                and method_col
                and goods_line_fk_column
            ):
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

                direct_value = _shared._coerce_float(line_direct_source, "direct_embedded_kgco2e")
                indirect_value = _shared._coerce_float(line_indirect_source, "indirect_embedded_kgco2e")
                emissions_insert: dict[str, object] = {
                    "id": str(uuid4()),
                    goods_line_fk_column: goods_line_id,
                    direct_col: direct_value if direct_value is not None else Decimal("0"),
                    indirect_col: indirect_value if indirect_value is not None else Decimal("0"),
                    method_col: line_method.value,
                    "version": 1,
                }
                emissions_row = _shared._insert_returning(conn, "cbam_emissions", emissions_insert)
                emissions_ids.append(str(emissions_row["id"]))
            elif warn_on_missing_emissions:
                warnings.append("emissions_missing")

        return {
            "case_id": case_id,
            "shipment_id": shipment_id,
            "goods_line_ids": goods_line_ids,
            "emissions_ids": emissions_ids,
            "warnings": warnings,
        }


@router.post("/drafts/from-parsed-invoice", status_code=status.HTTP_201_CREATED)
def create_cbam_draft_from_parsed_invoice(payload: _shared.CBAMDraftFromParsedInvoiceRequest):
    try:
        return _create_cbam_draft_from_parsed_invoice_payload(payload)
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "cbam_draft_create_failed", "message": str(exc.orig) if exc.orig else str(exc)},
        )


@router.post("/drafts/from-document", status_code=status.HTTP_201_CREATED)
async def create_cbam_draft_from_document(
    request: Request,
    file: UploadFile = File(...),
    importer_name: str | None = Form(default=None),
    importer_eori: str | None = Form(default=None),
    reporting_year: int | None = Form(default=None),
    reporting_quarter: int | None = Form(default=None),
):
    if not file.filename:
        return JSONResponse(
            status_code=422,
            content={"detail": "File name is required.", "stage": "extract"},
        )

    safe_filename = Path(file.filename).name or "upload.bin"
    run_id: str | None = getattr(request.state, "request_id", None)

    try:
        file_bytes = await file.read()
        # Hash the raw bytes immediately — this becomes the immutable chain root
        # for the entire audit trail (EU 2023/1773 auditability requirement).
        document_sha256_at_upload = _shared.bytes_sha256_hex(file_bytes)
        try:
            # Keep these assignments explicit so test monkeypatches on cbam_api symbols
            # continue to control the orchestration flow.
            _shared.ingest_orchestrator.extract_document_from_upload = _shared.extract_document_from_upload
            _shared.ingest_orchestrator.extract_cbam_document = _shared.extract_cbam_document
            _shared.ingest_orchestrator.LlamaOrchestrator = _shared.LlamaOrchestrator
            ingest_plan = _shared.ingest_orchestrator.run_document_ingest_plan(
                filename=safe_filename,
                content_type=file.content_type,
                data=file_bytes,
            )
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail, "stage": "extract"},
            )
        except Exception as exc:
            return JSONResponse(
                status_code=422,
                content={"detail": str(exc), "stage": "extract"},
            )

        raw_text = str(ingest_plan.get("raw_text", ""))
        layout = ingest_plan.get("layout")
        layout_payload = layout if isinstance(layout, dict) else None
        routing_trace = ingest_plan.get("routing_trace")
        if not isinstance(routing_trace, dict):
            routing_trace = {}

        raw_candidates = ingest_plan.get("candidates")
        if not isinstance(raw_candidates, list):
            return JSONResponse(
                status_code=422,
                content={"detail": "Extractor returned an invalid response.", "stage": "extract"},
            )
        candidates = [candidate for candidate in raw_candidates if isinstance(candidate, dict)]
        if not candidates:
            return JSONResponse(
                status_code=422,
                content={"detail": "Extractor returned no candidates.", "stage": "extract"},
            )

        try:
            arbiter_warnings: list[str] = []
            repair_warnings: list[str] = []
            rule_candidate = candidates[0]
            llama_output = routing_trace.get("llama_output")
            if llama_output is not None:
                extraction_validation = _shared.compare_extractions(rule_candidate, llama_output)
            else:
                extraction_validation = {"match_score": 100.0, "differences": []}

            if len(candidates) > 1:
                arbitrated_candidate, arbiter_warnings = _shared.arbitrate_parsed_invoice(candidates)
            else:
                arbitrated_candidate, arbiter_warnings = rule_candidate, []

            repaired_candidate, repair_warnings = _shared.repair_parsed_invoice(arbitrated_candidate)

            extraction_validation.update(
                {
                    "arbiter_warnings": arbiter_warnings,
                    "repair_warnings": repair_warnings,
                    "evidence": _shared._normalized_evidence(repaired_candidate.get("evidence")),
                    "fallback_sources": [],
                    "gemini_fallback_used": False,
                    "routing_trace": routing_trace,
                }
            )
        except Exception as exc:
            extraction_validation = {
                "match_score": 0.0,
                "differences": [f"ingest_orchestration_error:{exc}"],
                "evidence": [],
                "fallback_sources": [],
                "gemini_fallback_used": False,
                "routing_trace": routing_trace,
            }
            repaired_candidate = candidates[0]
            arbitrated_candidate = candidates[0]

        try:
            parsed_payload, resolved_year, resolved_quarter, parse_warnings = (
                _shared._build_parsed_invoice_request_from_extraction(
                    extraction=repaired_candidate,
                    importer_name=importer_name,
                    importer_eori=importer_eori,
                    reporting_year=reporting_year,
                    reporting_quarter=reporting_quarter,
                )
            )
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail, "stage": "extract"},
            )
        except Exception as exc:
            return JSONResponse(
                status_code=422,
                content={"detail": str(exc), "stage": "extract"},
            )

        try:
            dq_precheck = _shared._parsed_data_quality_precheck_from_payload(
                payload=parsed_payload,
                reporting_year=resolved_year,
                reporting_quarter=resolved_quarter,
            )
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail, "stage": "extract"},
            )
        except Exception as exc:
            return JSONResponse(
                status_code=422,
                content={"detail": str(exc), "stage": "extract"},
            )

        extraction_validation["data_quality"] = dq_precheck

        match_score = extraction_validation.get("match_score", 0.0)
        try:
            match_score_value = float(match_score)
        except (TypeError, ValueError):
            match_score_value = 0.0
        dq_blocking = bool(dq_precheck.get("blocking", False))

        if (
            _shared.ENABLE_GEMINI_FALLBACK
            and match_score_value < _shared.GEMINI_MATCH_THRESHOLD
            and dq_blocking
        ):
            gemini_output = _shared.extract_structured_with_gemini(raw_text)
            if gemini_output:
                gemini_candidate = _shared._llama_candidate_from_structured_invoice(
                    rule_candidate=rule_candidate if "rule_candidate" in locals() else candidates[0],
                    llama_output=gemini_output,
                    raw_text=raw_text,
                    layout_payload=layout_payload,
                )
                if gemini_candidate is not None:
                    gemini_candidate["source"] = "gemini"
                    if "candidates" in locals() and isinstance(candidates, list):
                        candidates.append(gemini_candidate)
                    else:
                        candidates = [dict(extraction), gemini_candidate]

                    extraction_validation["gemini_fallback_used"] = True
                    fallback_sources = extraction_validation.get("fallback_sources")
                    if not isinstance(fallback_sources, list):
                        fallback_sources = []
                    fallback_sources.append("gemini")
                    extraction_validation["fallback_sources"] = fallback_sources

                    if len(candidates) > 1:
                        arbitrated_candidate, arbiter_warnings = _shared.arbitrate_parsed_invoice(candidates)
                    else:
                        arbitrated_candidate, arbiter_warnings = candidates[0], []
                    repaired_candidate, repair_warnings = _shared.repair_parsed_invoice(arbitrated_candidate)

                    parsed_payload, resolved_year, resolved_quarter, parse_warnings = (
                        _shared._build_parsed_invoice_request_from_extraction(
                            extraction=repaired_candidate,
                            importer_name=importer_name,
                            importer_eori=importer_eori,
                            reporting_year=reporting_year,
                            reporting_quarter=reporting_quarter,
                        )
                    )
                    dq_precheck = _shared._parsed_data_quality_precheck_from_payload(
                        payload=parsed_payload,
                        reporting_year=resolved_year,
                        reporting_quarter=resolved_quarter,
                    )
                    extraction_validation["data_quality"] = dq_precheck
                    extraction_validation["arbiter_warnings"] = arbiter_warnings
                    extraction_validation["repair_warnings"] = repair_warnings
                    extraction_validation["evidence"] = _shared._normalized_evidence(repaired_candidate.get("evidence"))

        try:
            created = _create_cbam_draft_from_parsed_invoice_payload(
                parsed_payload,
                reporting_year_override=resolved_year,
                reporting_quarter_override=resolved_quarter,
                warn_on_missing_emissions=True,
            )
        except Exception as exc:
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"detail": str(exc), "stage": "draft"},
            )

        case_id_for_snapshot = str(created.get("case_id"))
        parent_hash: str | None = None
        extraction_stage_payload = {
            # document_sha256: SHA-256 of the raw upload bytes — immutable chain root.
            # This field makes the snapshot chain cryptographically traceable back to
            # the original source file (EU 2023/1773 Art. 6 auditability requirement).
            "document_sha256": document_sha256_at_upload,
            "raw_text": raw_text,
            "layout": layout_payload,
            "routing_trace": routing_trace,
            "candidates": candidates,
            "extraction_validation": {
                "match_score": extraction_validation.get("match_score"),
                "differences": extraction_validation.get("differences"),
                "fallback_sources": extraction_validation.get("fallback_sources"),
                "gemini_fallback_used": extraction_validation.get("gemini_fallback_used"),
            },
        }
        from ledger_app.core.version import APP_GIT_SHA, APP_VERSION

        _extraction_algo = {
            "rule_extractor": "v1",
            "layout": "v1",
            "app_git_sha": APP_GIT_SHA,
            "app_version": APP_VERSION,
            **({"run_id": run_id} if run_id else {}),
        }
        parent_hash = _shared._safe_snapshot_write(
            case_id=case_id_for_snapshot,
            stage="extraction_v1",
            payload=extraction_stage_payload,
            parent_hash=parent_hash,
            algo_versions=_extraction_algo,
            model_versions={
                "llama": str(os.getenv("LLAMA_STRUCTURED_MODEL", "unknown")),
                "gemini_enabled": bool(_shared.ENABLE_GEMINI_FALLBACK),
                "extraction_prompt": _EXTRACTION_PROMPT_VERSION,
            },
        )
        _shared._write_audit_event(
            case_id_for_snapshot,
            "cbam_extracted",
            {
                "document_sha256": document_sha256_at_upload,
                "snapshot_hash": parent_hash,
                "candidates_count": len(candidates) if isinstance(candidates, list) else 0,
                "gemini_fallback_used": extraction_validation.get("gemini_fallback_used", False),
                "run_id": run_id,
            },
        )
        parent_hash = _shared._safe_snapshot_write(
            case_id=case_id_for_snapshot,
            stage="arbitrated_v1",
            payload=arbitrated_candidate,
            parent_hash=parent_hash,
            algo_versions={
                "arbiter": "v1",
                "app_git_sha": APP_GIT_SHA,
                **({"run_id": run_id} if run_id else {}),
            },
        )
        _shared._write_audit_event(
            case_id_for_snapshot,
            "cbam_arbitrated",
            {
                "snapshot_hash": parent_hash,
                "arbiter_warnings": extraction_validation.get("arbiter_warnings", []),
                "invoice_number": (arbitrated_candidate.get("invoice") or {}).get("invoice_number"),
                "origin_country": (arbitrated_candidate.get("invoice") or {}).get("origin_country"),
                "run_id": run_id,
            },
        )
        parent_hash = _shared._safe_snapshot_write(
            case_id=case_id_for_snapshot,
            stage="repaired_v1",
            payload=repaired_candidate,
            parent_hash=parent_hash,
            algo_versions={
                "repair": "v1",
                "app_git_sha": APP_GIT_SHA,
                **({"run_id": run_id} if run_id else {}),
            },
        )

        repair_warns = extraction_validation.get("repair_warnings", [])
        arbiter_warns = extraction_validation.get("arbiter_warnings", [])
        dq_warns = []
        if isinstance(extraction_validation.get("data_quality"), dict):
            dq_data = extraction_validation["data_quality"]
            dq_warns.extend(f"dq_missing:{item}" for item in dq_data.get("missing", []))
            dq_warns.extend(f"dq_warning:{item}" for item in dq_data.get("warnings", []))

        merged_warnings = (
            parse_warnings
            + list(repair_warns if isinstance(repair_warns, list) else [])
            + list(arbiter_warns if isinstance(arbiter_warns, list) else [])
            + dq_warns
            + list(created.get("warnings", []))
        )
        return {
            "parsed": parsed_payload.model_dump(mode="json"),
            "created": created,
            "warnings": merged_warnings,
            "extraction_validation": extraction_validation,
            "document_sha256": document_sha256_at_upload,
        }
    finally:
        pass
