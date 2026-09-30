from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text

from shared_auth import require_scopes

from . import _shared
from ledger_app.db.rls import set_tenant_context

_log = logging.getLogger("nucleos.report")

router = APIRouter()


class HMRCReturnRequest(BaseModel):
    importer_vat_number: str = Field(..., description="UK VAT registration number (e.g. 'GB123456789').")
    importer_address: dict[str, str] = Field(
        ..., description="Importer postal address — line1, city, postcode at minimum."
    )
    accuracy_declaration: bool = Field(
        True, description="Must be True — certifies the return is accurate."
    )
    cbam_rate_override: Decimal | None = Field(
        None,
        description=(
            "Override the HMRC CBAM rate (£/tCO₂e). When omitted the rate is "
            "derived from the case's primary sector and reporting period via the "
            "UK CBAM rate table."
        ),
    )


@router.get("/cases/{case_id}/report-package")
def get_cbam_report_package(
    request: Request,
    case_id: UUID,
    export_format: Literal["json", "csv", "pdf"] = Query(
        default="json",
        alias="format",
        description="Export format. json returns the API response; csv and pdf trigger a file download.",
    ),
):
    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")
    run_id: str | None = getattr(request.state, "request_id", None)

    with _shared.engine.begin() as conn:
        set_tenant_context(conn, tenant_id)
        columns = _shared._table_columns(conn, "cbam_cases")
        _shared._enforce_tenant_id(columns, tenant_id)
        tenant_filter = "AND tenant_id = :tenant_id" if "tenant_id" in columns else ""
        case_rows = conn.execute(
            text(
                f"""
                SELECT *
                FROM cbam.cbam_cases
                WHERE id = :id {tenant_filter}
                LIMIT 1
                """
            ),
            {"id": str(case_id), "tenant_id": tenant_id},
        ).mappings().all()

        if not case_rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

        case_row = dict(case_rows[0])
        shipments_payload = _shared._build_case_shipments_payload(conn, case_id)
        data_quality = _shared.evaluate_cbam_data_quality(case_row, shipments_payload)

        # Human review gate
        # Block report generation when data quality is "blocking" (one or more
        # required fields are missing).  Rejection is written to the audit log so
        # the event is part of the immutable chain (EU 2023/1773 Art. 6).
        if data_quality.get("blocking"):
            blocking_issues = data_quality.get("missing", [])
            _shared._write_audit_event(
                str(case_id),
                "human_review_required",
                {
                    "reason": "blocking_data_quality",
                    "risk_tier": data_quality.get("risk_tier", "blocking"),
                    "score": data_quality.get("score"),
                    "blocking_issues": blocking_issues,
                    "run_id": run_id,
                },
            )
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "human_review_required",
                    "message": (
                        "Report package cannot be generated: data quality is blocking. "
                        "Resolve all missing required fields before submission to the EU registry."
                    ),
                    "risk_tier": data_quality.get("risk_tier", "blocking"),
                    "score": data_quality.get("score"),
                    "blocking_issues": blocking_issues,
                },
            )

        generated_at = datetime.now(timezone.utc).isoformat()
        extraction_evidence = _shared._extraction_evidence_summary(str(case_id))
        report_package = {
            "type": "cbam_report_package_v1",
            "generated_at": generated_at,
            "case": case_row,
            "shipments": shipments_payload,
            "summary": _shared._build_case_summary(conn, case_id),
            "data_quality": data_quality,
            "extraction_evidence": extraction_evidence,
        }
        snapshot_hash: str | None = None
        parent_hash: str | None = None

        from ledger_app.core.version import APP_GIT_SHA, APP_VERSION
        algo_versions: dict[str, object] = {
            "report_package_builder": "v1",
            "app_git_sha": APP_GIT_SHA,
            "app_version": APP_VERSION,
        }
        if run_id:
            algo_versions["run_id"] = run_id
        model_versions: dict[str, object] = {}

        try:
            snapshot = _shared.get_snapshot_store().append_snapshot(
                case_id=str(case_id),
                stage="report_package_v1",
                payload=report_package,
                algo_versions=algo_versions,
                model_versions=model_versions,
            )
            snapshot_hash = snapshot.payload_hash
            parent_hash = snapshot.parent_hash
            algo_versions = dict(snapshot.algo_versions)
            model_versions = dict(snapshot.model_versions)
        except Exception as exc:
            # A swallowed failure here would leave snapshot_hash=None on a
            # non-first record — the chain verifier then raises
            # ChainIntegrityError on every subsequent read, turning a
            # transient error into a permanent human_review_required flag
            # (CLAUDE.md Rule 5). Fail the request instead so the caller can
            # retry before any output is generated.
            _log.error(
                "Snapshot write failed for case_id=%s stage=report_package_v1: %s",
                case_id, exc,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Audit chain snapshot could not be written. The report package "
                    "has not been generated, to avoid corrupting the audit chain. "
                    "Please retry."
                ),
            ) from exc

        report_package["audit"] = _shared._report_package_audit_block(
            case_id=str(case_id),
            artifact_payload=report_package,
            generated_at=generated_at,
            snapshot_hash=snapshot_hash,
            parent_hash=parent_hash,
            algo_versions=algo_versions,
            model_versions=model_versions,
        )

        from ledger_app.services.report_exporter import to_csv, to_json, to_pdf

        safe_id = str(case_id).replace("/", "_")

        if export_format == "csv":
            return Response(
                content=to_csv(report_package).encode("utf-8"),
                media_type="text/csv",
                headers={
                    "Content-Disposition": f'attachment; filename="cbam-report-{safe_id}.csv"'
                },
            )
        if export_format == "pdf":
            return Response(
                content=to_pdf(report_package),
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f'attachment; filename="cbam-report-{safe_id}.pdf"'
                },
            )
        # Default: JSON (pretty-printed, same structure as before)
        return Response(
            content=to_json(report_package).encode("utf-8"),
            media_type="application/json",
        )


@router.post(
    "/cases/{case_id}/hmrc-return",
    dependencies=[Depends(require_scopes(["cbam:write"]))],
)
def build_case_hmrc_return(
    request: Request,
    case_id: UUID,
    payload: HMRCReturnRequest,
    export_format: Literal["json", "pdf"] = Query(
        default="json",
        alias="format",
        description="json returns the structured return document; pdf triggers a file download.",
    ),
):
    """Build the UK HMRC CBAM tax return for a case.

    Fetches the report package, loads all confirmed CPR claims, derives the
    applicable CBAM rate, and assembles the HMRCReturnDocument.

    Each goods line's latest CPR claim with its verifier's statement attached is
    applied as Carbon Price Relief, capped at that line's own CBAM charge.

    Requires: accuracy_declaration = True (certifies the return is accurate).
    """
    from app.services.cbam_uk_rates import (  # noqa: PLC0415
        UKCBAMRateMissing,
        UKCBAMRatePlaceholder,
        get_uk_cbam_rate_or_raise,
    )
    from app.services.cpr_repository import get_cpr_by_goods_line_db  # noqa: PLC0415
    from app.services.hmrc_return_builder import (  # noqa: PLC0415
        HMRCReturnInput,
        HMRCReturnValidationError,
        build_hmrc_return,
        return_to_json,
        return_to_pdf,
    )

    if not payload.accuracy_declaration:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="accuracy_declaration must be True — the importer must certify the return.",
        )

    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")

    with _shared.engine.begin() as conn:
        set_tenant_context(conn, tenant_id)
        columns = _shared._table_columns(conn, "cbam_cases")
        _shared._enforce_tenant_id(columns, tenant_id)
        tenant_filter = "AND tenant_id = :tenant_id" if "tenant_id" in columns else ""

        case_rows = conn.execute(
            text(
                f"""
                SELECT *
                FROM cbam.cbam_cases
                WHERE id = :id {tenant_filter}
                LIMIT 1
                """
            ),
            {"id": str(case_id), "tenant_id": tenant_id},
        ).mappings().all()

        if not case_rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

        case_row = dict(case_rows[0])

        # CPR: each goods line's latest verified claim, capped per line by the builder
        cpr_by_goods_line = get_cpr_by_goods_line_db(conn, str(case_id), tenant_id)

        # Build report package
        shipments_payload = _shared._build_case_shipments_payload(conn, case_id)

    # Derive CBAM rate
    # Use the override when provided; otherwise resolve from the primary sector.
    if payload.cbam_rate_override is not None:
        cbam_rate = payload.cbam_rate_override
    else:
        year    = int(case_row.get("reporting_year") or 0)
        quarter = int(case_row.get("reporting_quarter") or 1) if year > 2027 else None

        # Derive primary sector from the first goods line across shipments
        primary_sector: str | None = None
        for ship_item in shipments_payload:
            for gl_item in ship_item.get("goods_lines") or []:
                gl = gl_item.get("goods_line") or {}
                if gl.get("sector"):
                    primary_sector = str(gl["sector"])
                    break
            if primary_sector:
                break

        try:
            cbam_rate = get_uk_cbam_rate_or_raise(
                primary_sector or "iron_steel", year, quarter, reject_placeholder=True
            )
        except UKCBAMRateMissing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"No UK CBAM rate found for sector={primary_sector!r} "
                    f"year={year} quarter={quarter}. "
                    "Supply cbam_rate_override in the request body."
                ),
            )
        except UKCBAMRatePlaceholder:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"HMRC has not yet published the CBAM rate for sector={primary_sector!r} "
                    f"year={year} quarter={quarter}. Only HMRC-published rates may be used in "
                    "a production HMRC return. Supply cbam_rate_override to proceed with a "
                    "manually confirmed rate."
                ),
            )

    report_package = {
        "type": "cbam_report_package_v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "case": case_row,
        "shipments": shipments_payload,
    }

    # goods_line_id → verifier reference, for every line whose statement was
    # accepted. The builder reports those as actual_verified; without the map
    # every supplier figure went on the return as unverified.
    verification_refs = {
        str(entry["goods_line"]["id"]): str(entry["goods_line"]["verification_reference"])
        for shipment in shipments_payload
        for entry in shipment.get("goods_lines") or []
        if entry.get("goods_line", {}).get("verification_reference")
    }

    return_input = HMRCReturnInput(
        importer_vat_number     = payload.importer_vat_number,
        importer_address        = payload.importer_address,
        cbam_rate_gbp_per_tco2e = cbam_rate,
        accuracy_declaration    = True,
        cpr_by_goods_line       = cpr_by_goods_line,
        verification_refs       = verification_refs,
    )

    try:
        return_doc = build_hmrc_return(report_package, return_input)
    except HMRCReturnValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": "HMRC return validation failed", "failures": exc.failures},
        ) from exc

    safe_id = str(case_id).replace("/", "_")

    if export_format == "pdf":
        return Response(
            content=return_to_pdf(return_doc),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="hmrc-cbam-return-{safe_id}.pdf"'},
        )


    def _serial(obj):
        if isinstance(obj, Decimal):
            return str(obj)
        from datetime import date, datetime as dt
        if isinstance(obj, (date, dt)):
            return obj.isoformat()
        raise TypeError(type(obj).__name__)

    return Response(
        content=return_to_json(return_doc).encode("utf-8"),
        media_type="application/json",
    )


@router.post(
    "/cases/{case_id}/eu-xml",
    dependencies=[Depends(require_scopes(["cbam:write"]))],
)
def build_case_eu_xml(request: Request, case_id: UUID):
    """Build the EU quarterly CBAM declaration XML for a case.

    The counterpart of ``/hmrc-return``. The builder has existed since the EU
    output was written; it had no route, so the one thing the EU half of the
    product exists to produce could not be produced.

    Returns the XML as a download. A UK-only case returns 422 rather than an
    empty document: the builder answers ``None`` for those deliberately, and a
    zero-byte file offered as a declaration is worse than a refusal.

    Structurally validated before it is returned. An XML that the registry will
    reject on receipt is not an output — it is a failure the importer discovers
    at the point of filing.
    """
    from app.services.eu_xml_builder import (  # noqa: PLC0415
        build_xml_for_case,
        validate_xml_structure,
    )

    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")

    with _shared.engine.begin() as conn:
        set_tenant_context(conn, tenant_id)
        columns = _shared._table_columns(conn, "cbam_cases")
        _shared._enforce_tenant_id(columns, tenant_id)
        tenant_filter = "AND tenant_id = :tenant_id" if "tenant_id" in columns else ""

        case_rows = conn.execute(
            text(
                f"""
                SELECT *
                FROM cbam.cbam_cases
                WHERE id = :id {tenant_filter}
                LIMIT 1
                """
            ),
            {"id": str(case_id), "tenant_id": tenant_id},
        ).mappings().all()

        if not case_rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

        case_row = dict(case_rows[0])
        if case_row.get("importer_eori"):
            case_row["importer_eori"] = _shared.decrypt_field(case_row["importer_eori"])

        shipments_payload = _shared._build_case_shipments_payload(conn, case_id)
        data_quality = _shared.evaluate_cbam_data_quality(case_row, shipments_payload)

    # Same gate as the report package. A declaration missing a required field is
    # rejected by the registry on receipt, and finding that out at the point of
    # filing is the worst place to find it out.
    if data_quality.get("blocking"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "human_review_required",
                "message": (
                    "The EU declaration cannot be built: required data is missing. "
                    "Resolve the open gaps on this case first."
                ),
                "blocking_issues": data_quality.get("missing", []),
            },
        )

    # Flatten to the goods-line shape the builder reads, merging each line's
    # latest emissions record onto it.
    goods_lines: list[dict] = []
    for ship_entry in shipments_payload:
        shipment = ship_entry.get("shipment") or {}
        for gl_entry in ship_entry.get("goods_lines") or []:
            gl: dict = dict(gl_entry.get("goods_line") or {})
            em = gl_entry.get("latest_emissions") or {}
            gl["direct_kgco2e"] = em.get("direct_kgco2e") or em.get("direct_embedded_kgco2e")
            gl["indirect_kgco2e"] = em.get("indirect_kgco2e") or em.get("indirect_embedded_kgco2e")
            gl["method"] = em.get("method")
            gl["origin_country"] = shipment.get("origin_country")
            goods_lines.append(gl)

    if not goods_lines:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This case has no goods lines, so there is nothing to declare.",
        )

    try:
        xml = build_xml_for_case(case_row, goods_lines)
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"The EU declaration could not be built: {exc}",
        ) from exc

    if xml is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "This case is filed under the UK regime, which has no EU registry "
                "declaration. Use the HMRC return instead."
            ),
        )

    errors = validate_xml_structure(xml)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "xml_validation_failed",
                "message": "The EU declaration was built but is not structurally valid.",
                "errors": errors,
            },
        )

    try:
        _shared._write_audit_event(
            str(case_id),
            "eu_xml_generated",
            {
                "reporting_year": case_row.get("reporting_year"),
                "reporting_quarter": case_row.get("reporting_quarter"),
                "goods_line_count": len(goods_lines),
            },
        )
    except Exception:  # noqa: BLE001 — audit failure must not withhold the output
        _log.warning("Audit event write failed for eu_xml_generated case_id=%s", case_id)

    safe_id = str(case_id).replace("/", "_")
    return Response(
        content=xml.encode("utf-8"),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="cbam-eu-declaration-{safe_id}.xml"'},
    )
