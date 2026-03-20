"""
Narrative pipeline router — thin shim over app.services.narrative.

Registers at the same paths as the old nucleo-narrative pipeline router so
external API calls continue to work without change:

    POST /api/cases/{case_id}/narrative/pipeline
    POST /api/cases/{case_id}/narrative/pipeline/async

Single Claude call replaces the former 3-stage OpenAI → Claude → Gemini pipeline.
All processing is synchronous — completes within the HTTP request cycle.
Response shape: {case_id, final_narrative_json, human_review_required, stage_errors}
"""
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse

from app.services.narrative import run_pipeline_stages
from shared_auth.dependencies import require_scopes
from shared_auth.models import AuthContext

router = APIRouter()


def _blocking_response(case_id: str, data_quality: dict) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "message": "Data quality blocking issues",
            "case_id": case_id,
            "data_quality": data_quality,
        },
    )


@router.post("/cases/{case_id}/narrative/pipeline")
def run_pipeline(
    request: Request,
    case_id: str,
    background_tasks: BackgroundTasks,
    packet_kind: Literal["legacy", "cbam"] = "legacy",
    auth_context: AuthContext = Depends(require_scopes(["narrative:run"])),
):
    """
    Run the narrative pipeline (single Claude call) synchronously.

    Fetches the report package via direct in-process call, calls Claude once
    to generate prose, then hard-overrides results{} with authoritative packet values.
    Runs a deterministic validator (replaces Gemini QA gate).
    Returns 422 if data quality is blocking; 200 with narrative otherwise.
    """
    result = run_pipeline_stages(
        case_id=case_id,
        packet_kind=packet_kind,
        request=request,
        background_tasks=background_tasks,
    )
    if result.get("blocked"):
        return _blocking_response(case_id, result.get("data_quality", {}))
    return result


@router.post("/cases/{case_id}/narrative/pipeline/async")
async def run_pipeline_async(
    request: Request,
    case_id: str,
    background_tasks: BackgroundTasks,
    packet_kind: Literal["legacy", "cbam"] = "legacy",
    auth_context: AuthContext = Depends(require_scopes(["narrative:run"])),
):
    """
    Synchronous execution under the /async path for API compatibility.

    Returns the same shape as the sync endpoint, with job_id=None and
    status="done" so callers that poll the job result get an immediate answer.
    """
    result = run_pipeline_stages(
        case_id=case_id,
        packet_kind=packet_kind,
        request=request,
        background_tasks=background_tasks,
    )
    if result.get("blocked"):
        return _blocking_response(case_id, result.get("data_quality", {}))
    return {"job_id": None, "status": "done", "result": result}
