from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app.api.pipeline import run_pipeline
from app.services.compliance_pack import build_cbam_compliance_pack
from app.services.ledger_client import fetch_cbam_report_package

router = APIRouter()


@router.post("/cbam/cases/{case_id}/compliance-pack")
def create_cbam_compliance_pack(case_id: str):
    try:
        report_package = fetch_cbam_report_package(case_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Failed to fetch CBAM report-package from nucleo-ledger",
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

    pipeline_result = run_pipeline(case_id=case_id, packet_kind="cbam")
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
