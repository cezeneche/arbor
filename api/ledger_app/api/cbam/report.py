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


@router.get("/cases/{case_id}/summary")
def get_cbam_case_summary(request: Request, case_id: UUID):
    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")
    with _shared.engine.begin() as conn:
        set_tenant_context(conn, tenant_id)
        _shared._manual_fk_check(conn, "cbam_cases", case_id, "case_id")
        columns = _shared._table_columns(conn, "cbam_cases")
        _shared._enforce_tenant_id(columns, tenant_id)
        tenant_filter = "AND tenant_id = :tenant_id" if "tenant_id" in columns else ""
        case_row = conn.execute(
            text(
                f"""
                SELECT *
                FROM cbam.cbam_cases
                WHERE id = :id {tenant_filter}
                LIMIT 1
                """
            ),
            {"id": str(case_id), "tenant_id": tenant_id},
        ).mappings().one_or_none()
        if case_row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        shipments_payload = _shared._build_case_shipments_payload(conn, case_id)
        summary = _shared._build_case_summary(conn, case_id)
        summary["data_quality"] = _shared.evaluate_cbam_data_quality(dict(case_row), shipments_payload)
        return summary


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

        # ── Human review gate ─────────────────────────────────────────────────
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


@router.post("/cases/{case_id}/liability", dependencies=[Depends(require_scopes(["cbam:write"]))])
def compute_case_liability(request: Request, case_id: UUID, payload: _shared.CBAMLiabilityRequest):
    """Compute CBAM liability (SEE formula + certificate count) for a case.

    Fetches the latest emission record for every goods line in the case,
    computes Specific Embedded Emissions (tCO2e/t) per EU 2023/1773 Art. 3,
    then calculates the net CBAM liability and certificate count per
    EU 2023/956 Arts. 9 and 21.

    The EU ETS price must be provided by the caller (weekly average price
    for the reporting quarter; source: EEX or ICE).  Carbon price already paid
    in the origin country defaults to 0 (no deduction) when not supplied.
    """
    run_id: str | None = getattr(request.state, "request_id", None)

    with _shared.engine.begin() as conn:
        _shared._manual_fk_check(conn, "cbam_cases", case_id, "case_id")

        # ── Human review gate ─────────────────────────────────────────────────
        case_columns = _shared._table_columns(conn, "cbam_cases")
        tenant_filter = "AND tenant_id = :tenant_id" if "tenant_id" in case_columns else ""
        tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")
        case_row_rows = conn.execute(
            text(f"SELECT * FROM cbam.cbam_cases WHERE id = :id {tenant_filter} LIMIT 1"),
            {"id": str(case_id), "tenant_id": tenant_id},
        ).mappings().all()
        if case_row_rows:
            _dq = _shared.evaluate_cbam_data_quality(dict(case_row_rows[0]), [])
            if _dq.get("blocking"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={
                        "code": "human_review_required",
                        "message": (
                            "Liability cannot be calculated: data quality is blocking. "
                            "Resolve all missing required fields first."
                        ),
                        "risk_tier": _dq.get("risk_tier", "blocking"),
                        "score": _dq.get("score"),
                        "blocking_issues": _dq.get("missing", []),
                    },
                )

        shipments_cols = _shared._table_columns(conn, "cbam_shipments")
        goods_cols = _shared._table_columns(conn, "cbam_goods_lines")
        emissions_cols = _shared._table_columns(conn, "cbam_emissions")

        case_fk_col = _shared._pick_existing(shipments_cols, ["cbam_case_id", "case_id"])
        if not case_fk_col:
            raise HTTPException(status_code=500, detail="Internal server error")

        mass_col = _shared._pick_existing(goods_cols, ["net_mass_kg", "quantity"])
        cn_col = _shared._pick_existing(goods_cols, ["cn_code"])
        if not mass_col or not cn_col:
            raise HTTPException(status_code=500, detail="Internal server error")

        direct_col = _shared._pick_existing(emissions_cols, ["direct_kgco2e", "direct_emissions_kgco2e", "direct_embedded_kgco2e"])
        indirect_col = _shared._pick_existing(emissions_cols, ["indirect_kgco2e", "indirect_emissions_kgco2e", "indirect_embedded_kgco2e"])
        if not direct_col or not indirect_col:
            raise HTTPException(status_code=500, detail="Internal server error")

        rows = conn.execute(
            text(
                f"""
                WITH latest_emissions AS (
                    SELECT e.goods_line_id,
                           e.{direct_col}   AS direct_kgco2e,
                           e.{indirect_col} AS indirect_kgco2e
                    FROM cbam.cbam_emissions e
                    INNER JOIN (
                        SELECT goods_line_id, MAX(version) AS max_ver
                        FROM cbam.cbam_emissions
                        GROUP BY goods_line_id
                    ) mx ON mx.goods_line_id = e.goods_line_id
                        AND mx.max_ver = e.version
                )
                SELECT
                    gl.id          AS goods_line_id,
                    gl.{cn_col}    AS cn_code,
                    gl.{mass_col}  AS net_mass_kg,
                    COALESCE(le.direct_kgco2e, 0)   AS direct_kgco2e,
                    COALESCE(le.indirect_kgco2e, 0) AS indirect_kgco2e
                FROM cbam.cbam_goods_lines gl
                INNER JOIN cbam.cbam_shipments s ON s.id = gl.shipment_id
                LEFT  JOIN latest_emissions le ON le.goods_line_id = gl.id
                WHERE s.{case_fk_col} = :case_id
                ORDER BY gl.id
                """
            ),
            {"case_id": str(case_id)},
        ).mappings().all()

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No goods lines found for this case. Upload a document and record emissions first.",
        )

    goods_lines = [
        {
            "goods_line_id": str(row["goods_line_id"]),
            "cn_code": str(row["cn_code"] or ""),
            "net_mass_kg": Decimal(str(row["net_mass_kg"] or 0)),
            "direct_kgco2e": Decimal(str(row["direct_kgco2e"] or 0)),
            "indirect_kgco2e": Decimal(str(row["indirect_kgco2e"] or 0)),
        }
        for row in rows
    ]

    # Auto-detect recognised Art. 9 carbon pricing scheme for origin country
    scheme = _shared.lookup_carbon_pricing_scheme(payload.origin_country)

    result = _shared.compute_cbam_liability(
        goods_lines=goods_lines,
        eu_ets_price_eur=payload.eu_ets_price_eur,
        carbon_price_paid_eur=payload.carbon_price_paid_eur,
        origin_country=payload.origin_country,
        carbon_pricing_scheme_name=scheme.scheme_name if scheme else None,
        carbon_pricing_scheme_type=scheme.scheme_type if scheme else None,
    )

    goods_lines_out = [
        {
            "goods_line_id": gl.goods_line_id,
            "cn_code": gl.cn_code,
            "net_mass_kg": gl.net_mass_kg,
            "net_mass_t": gl.net_mass_t,
            "direct_kgco2e": gl.direct_kgco2e,
            "indirect_kgco2e": gl.indirect_kgco2e,
            "total_kgco2e": gl.total_kgco2e,
            "see_direct_tco2e_per_t": gl.see_direct_tco2e_per_t,
            "see_indirect_tco2e_per_t": gl.see_indirect_tco2e_per_t,
            "see_total_tco2e_per_t": gl.see_total_tco2e_per_t,
            "embedded_tco2e": gl.embedded_tco2e,
        }
        for gl in result.goods_lines
    ]

    response = {
        "case_id": str(case_id),
        "eu_ets_price_eur": result.eu_ets_price_eur,
        "carbon_price_paid_eur": result.carbon_price_paid_eur,
        "origin_country": result.origin_country,
        "carbon_pricing_scheme_applies": scheme is not None,
        "carbon_pricing_scheme_name": result.carbon_pricing_scheme_name,
        "carbon_pricing_scheme_type": result.carbon_pricing_scheme_type,
        "goods_lines": goods_lines_out,
        "total_net_mass_t": result.total_net_mass_t,
        "total_direct_kgco2e": result.total_direct_kgco2e,
        "total_indirect_kgco2e": result.total_indirect_kgco2e,
        "total_embedded_tco2e": result.total_embedded_tco2e,
        "carbon_price_deduction_tco2e": result.carbon_price_deduction_tco2e,
        "net_liability_tco2e": result.net_liability_tco2e,
        "gross_financial_liability_eur": result.gross_financial_liability_eur,
        "net_financial_liability_eur": result.net_financial_liability_eur,
        "cbam_certificates": result.cbam_certificates,
        "regulation_refs": result.regulation_refs,
    }

    # Persist calculation as an immutable snapshot (calculation_v1) for audit trail.
    # This allows third parties to reproduce the SEE formula and verify the inputs.
    try:
        from ledger_app.services.cbam_emission_factors import FACTOR_METADATA
        from ledger_app.services.cbam_taric import TARIC_METADATA
        from ledger_app.core.version import APP_GIT_SHA, APP_VERSION

        calculation_snapshot = {
            "type": "cbam_calculation_v1",
            "formula": "SEE = direct_kgco2e/net_mass_kg + indirect_kgco2e/net_mass_kg (EU 2023/1773 Art. 3)",
            "regulation_refs": result.regulation_refs,
            "emission_factor_provenance": FACTOR_METADATA,
            "taric_provenance": TARIC_METADATA,
            "inputs": {
                "eu_ets_price_eur": str(result.eu_ets_price_eur),
                "carbon_price_paid_eur": str(result.carbon_price_paid_eur),
                "origin_country": result.origin_country,
                "carbon_pricing_scheme_name": result.carbon_pricing_scheme_name,
                "carbon_pricing_scheme_type": result.carbon_pricing_scheme_type,
            },
            "goods_lines": goods_lines_out,
            "outputs": {
                "total_net_mass_t": str(result.total_net_mass_t),
                "total_direct_kgco2e": str(result.total_direct_kgco2e),
                "total_indirect_kgco2e": str(result.total_indirect_kgco2e),
                "total_embedded_tco2e": str(result.total_embedded_tco2e),
                "carbon_price_deduction_tco2e": str(result.carbon_price_deduction_tco2e),
                "net_liability_tco2e": str(result.net_liability_tco2e),
                "gross_financial_liability_eur": str(result.gross_financial_liability_eur),
                "net_financial_liability_eur": str(result.net_financial_liability_eur),
                "cbam_certificates": result.cbam_certificates,
            },
        }
        calc_snapshot = _shared.get_snapshot_store().append_snapshot(
            case_id=str(case_id),
            stage="calculation_v1",
            payload=calculation_snapshot,
            algo_versions={
                "cbam_calculation_service": "v1",
                "see_formula": "EU-2023-1773-Art3",
                "emission_factor_table": FACTOR_METADATA["table_version"],
                "emission_factor_regulation": FACTOR_METADATA["regulation"],
                "emission_factor_oj": FACTOR_METADATA["oj_reference"],
                "emission_factor_sha256_prefix": FACTOR_METADATA.get("table_sha256", "")[:16],
                "taric_table": TARIC_METADATA["table_version"],
                "taric_sha256_prefix": TARIC_METADATA["sha256"][:16],
                "app_git_sha": APP_GIT_SHA,
                "app_version": APP_VERSION,
                **({"run_id": run_id} if run_id else {}),
            },
            model_versions={},
        )
        _shared._write_audit_event(
            str(case_id),
            "cbam_calculation_completed",
            {
                "snapshot_hash": calc_snapshot.payload_hash,
                "eu_ets_price_eur": str(result.eu_ets_price_eur),
                "carbon_price_paid_eur": str(result.carbon_price_paid_eur),
                "origin_country": result.origin_country,
                "net_liability_tco2e": str(result.net_liability_tco2e),
                "cbam_certificates": result.cbam_certificates,
                "emission_factor_table": FACTOR_METADATA["table_version"],
                "taric_table": TARIC_METADATA["table_version"],
                "run_id": run_id,
            },
        )
    except Exception:
        pass  # Snapshot/audit failure must not block the caller

    return response


@router.get("/regulatory-tables")
def get_regulatory_tables():
    """Return current EU regulatory table versions and SHA-256 checksums.

    Used by third-party auditors and the EU CBAM registry to verify that
    calculations were performed against the correct published table versions
    without requiring access to the platform's source code.

    No authentication required — this is public regulatory metadata.
    """
    from ledger_app.services.cbam_emission_factors import FACTOR_METADATA
    from ledger_app.services.cbam_taric import TARIC_METADATA
    from ledger_app.core.version import APP_GIT_SHA, APP_VERSION

    return {
        "annex_vi": FACTOR_METADATA,
        "taric": TARIC_METADATA,
        "platform": {
            "git_sha": APP_GIT_SHA,
            "version": APP_VERSION,
        },
    }


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

    CPR claims persisted via POST /api/cbam/cpr/claims are automatically
    summed per consignment and applied as Carbon Price Relief — reducing the
    net CBAM liability in the return.

    Requires: accuracy_declaration = True (certifies the return is accurate).
    """
    from app.services.cbam_uk_rates import (  # noqa: PLC0415
        UKCBAMRateMissing,
        UKCBAMRatePlaceholder,
        get_uk_cbam_rate_or_raise,
    )
    from app.services.cpr_calculator import get_cpr_by_consignment_db  # noqa: PLC0415
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

        # ── CPR: sum claims per consignment ───────────────────────────────────
        cpr_by_consignment = get_cpr_by_consignment_db(conn, str(case_id), tenant_id)

        # ── Build report package ──────────────────────────────────────────────
        shipments_payload = _shared._build_case_shipments_payload(conn, case_id)

    # ── Derive CBAM rate ──────────────────────────────────────────────────────
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

    return_input = HMRCReturnInput(
        importer_vat_number     = payload.importer_vat_number,
        importer_address        = payload.importer_address,
        cbam_rate_gbp_per_tco2e = cbam_rate,
        accuracy_declaration    = True,
        cpr_by_consignment      = cpr_by_consignment,
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

    import json as _json  # noqa: PLC0415
    from dataclasses import asdict  # noqa: PLC0415

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
