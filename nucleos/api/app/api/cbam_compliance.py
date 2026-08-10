from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from shared_auth.dependencies import require_scopes
from shared_auth.models import AuthContext

from app.services.compliance_pack import build_cbam_compliance_pack

router = APIRouter(tags=["compliance"])


@router.post("/cbam/cases/{case_id}/compliance-pack")
def create_cbam_compliance_pack(
    request: Request,
    case_id: str,
    background_tasks: BackgroundTasks,
    auth_context: AuthContext = Depends(require_scopes(["narrative:run"])),
):
    """
    Build a CBAM compliance pack for the given case.

    Fetches the report package via direct in-process call (no HTTP) and runs
    the single-Claude narrative pipeline, then assembles the compliance pack.
    """
    from app.services.narrative import fetch_report_packet, run_pipeline_stages

    # Fetch report package directly (no inter-service HTTP)
    try:
        report_package = fetch_report_packet(case_id, "cbam", request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Failed to fetch CBAM report-package",
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

    # Run the consolidated single-Claude pipeline — pass the already-fetched
    # report_package so run_pipeline_stages doesn't fetch (and snapshot) it again.
    pipeline_result = run_pipeline_stages(
        case_id=case_id,
        packet_kind="cbam",
        request=request,
        background_tasks=background_tasks,
        packet=report_package,
    )

    if pipeline_result.get("blocked"):
        return JSONResponse(
            status_code=422,
            content={
                "message": "Data quality blocking issues",
                "case_id": case_id,
                "data_quality": pipeline_result.get("data_quality", {}),
            },
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
