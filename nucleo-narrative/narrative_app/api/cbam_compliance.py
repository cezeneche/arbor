from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from shared_auth.dependencies import require_scopes
from shared_auth.models import AuthContext

from narrative_app.api.pipeline import _run_pipeline_stages
from narrative_app.services.compliance_pack import build_cbam_compliance_pack
from narrative_app.services.ledger_client import LedgerClientError, fetch_cbam_report_package

router = APIRouter()


@router.post("/cbam/cases/{case_id}/compliance-pack")
def create_cbam_compliance_pack(
    request: Request,
    case_id: str,
    auth_context: AuthContext = Depends(require_scopes(["narrative:run"])),
):
    tenant_id = auth_context.tenant_id
    trace_id: str | None = getattr(request.state, "request_id", None)

    try:
        report_package = fetch_cbam_report_package(
            case_id, tenant_id=tenant_id, trace_id=trace_id
        )
    except LedgerClientError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Failed to fetch CBAM report-package from nucleo-ledger",
                "error_code": exc.code,
                "error": exc.message,
                "case_id": case_id,
                "upstream": exc.to_dict(),
            },
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Failed to fetch CBAM report-package from nucleo-ledger",
                "error_code": "ledger_down",
                "error": str(exc),
                "case_id": case_id,
            },
        ) from exc

    data_quality = report_package.get("data_quality") or {}
    if bool(data_quality.get("blocking")):
        return JSONResponse(
            status_code=422,
            content={
                "message": "Data quality blocking issues",
                "case_id": case_id,
                "data_quality": data_quality,
            },
        )

    pipeline_result = _run_pipeline_stages(
        case_id=case_id,
        packet_kind="cbam",
        tenant_id=tenant_id,
        trace_id=trace_id,
    )
    narrative = pipeline_result.get("final_narrative_json")
    if not isinstance(narrative, dict):
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Pipeline did not return final_narrative_json",
                "case_id": case_id,
                "pipeline_result": pipeline_result,
            },
        )

    return build_cbam_compliance_pack(
        case_id=case_id,
        report_package=report_package,
        narrative=narrative,
    )
