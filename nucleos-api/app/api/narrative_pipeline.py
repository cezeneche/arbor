"""
Narrative pipeline router — thin shim over app.services.narrative.

Registers at the same paths as the old nucleo-narrative pipeline router so
external API calls continue to work without change:

    POST /api/cases/{case_id}/narrative/pipeline
    POST /api/cases/{case_id}/narrative/pipeline/async

Single Claude call replaces the former 3-stage OpenAI → Claude → Gemini pipeline.
Response shape: {case_id, final_narrative_json, human_review_required, stage_errors}
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter

from app.services.narrative import run_pipeline_stages
from narrative_app.core.metrics import pipeline_active
from narrative_app.core.rate_limit import user_or_ip_key
from shared_auth.dependencies import require_scopes
from shared_auth.models import AuthContext

router = APIRouter()
_limiter = Limiter(key_func=user_or_ip_key)


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
@_limiter.limit("10/minute")
def run_pipeline(
    request: Request,
    case_id: str,
    packet_kind: Literal["legacy", "cbam"] = "legacy",
    auth_context: AuthContext = Depends(require_scopes(["narrative:run"])),
):
    """
    Run the narrative pipeline (single Claude call) synchronously.

    Fetches the report package via direct in-process call, calls Claude once
    to generate prose, then hard-overrides results{} with authoritative packet values.
    Returns 422 if data quality is blocking; 200 with narrative otherwise.
    """
    pipeline_active.inc()
    try:
        result = run_pipeline_stages(
            case_id=case_id,
            packet_kind=packet_kind,
            request=request,
        )
    finally:
        pipeline_active.dec()

    if result.get("blocked"):
        return _blocking_response(case_id, result.get("data_quality", {}))
    return result


@router.post("/cases/{case_id}/narrative/pipeline/async")
@_limiter.limit("10/minute")
async def run_pipeline_async(
    request: Request,
    case_id: str,
    packet_kind: Literal["legacy", "cbam"] = "legacy",
    auth_context: AuthContext = Depends(require_scopes(["narrative:run"])),
):
    """
    Enqueue the 3-stage LLM pipeline as a background ARQ job.

    Returns immediately with a job_id for polling via GET /api/narrative/jobs/{job_id}.
    Falls back to synchronous execution when Redis is not configured.

    Note: the ARQ worker (nucleos-api/worker.py) must import run_pipeline_stages
    from app.services.narrative, not from narrative_app.api.pipeline.
    """
    from narrative_app.core.redis_pool import REDIS_URL

    if not REDIS_URL:
        # No Redis — run synchronously and return inline
        pipeline_active.inc()
        try:
            result = run_pipeline_stages(
                case_id=case_id,
                packet_kind=packet_kind,
                request=request,
            )
        finally:
            pipeline_active.dec()

        if result.get("blocked"):
            return _blocking_response(case_id, result.get("data_quality", {}))
        return {"job_id": None, "status": "done", "result": result}

    try:
        from arq import create_pool
        from arq.connections import RedisSettings

        arq_pool = await create_pool(RedisSettings.from_dsn(REDIS_URL))
        job = await arq_pool.enqueue_job(
            "run_pipeline_job",
            case_id=case_id,
            packet_kind=packet_kind,
            tenant_id=auth_context.tenant_id,
            trace_id=getattr(request.state, "request_id", None),
        )
        return {"job_id": job.job_id if job else None, "status": "queued"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Failed to enqueue job: {exc}")
