from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from typing import Literal
from slowapi import Limiter
from shared_auth.models import AuthContext
from shared_auth.dependencies import require_scopes
from narrative_app.core.rate_limit import user_or_ip_key
from narrative_app.core.metrics import pipeline_active

from narrative_app.services.ledger_client import (
    LedgerClientError,
    fetch_cbam_report_package,
    fetch_report_package,
)
from narrative_app.services.openai_writer import generate_draft
from narrative_app.services.claude_reviewer import review_narrative
from narrative_app.services.gemini_gate import gate

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


def _fetch_packet(case_id: str, packet_kind: str, tenant_id: str, trace_id: str | None) -> dict:
    """Fetch the structured report packet from nucleo-ledger."""
    try:
        return (
            fetch_cbam_report_package(case_id, tenant_id=tenant_id, trace_id=trace_id)
            if packet_kind == "cbam"
            else fetch_report_package(case_id, tenant_id=tenant_id, trace_id=trace_id)
        )
    except LedgerClientError as e:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Failed to fetch report-package from nucleo-ledger",
                "error_code": e.code,
                "error": e.message,
                "case_id": case_id,
                "packet_kind": packet_kind,
                "upstream": e.to_dict(),
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Failed to fetch report-package from nucleo-ledger",
                "error_code": "ledger_down",
                "error": str(e),
                "case_id": case_id,
                "packet_kind": packet_kind,
            },
        )


def _run_pipeline_stages(
    *,
    case_id: str,
    packet_kind: str = "legacy",
    tenant_id: str = "",
    trace_id: str | None = None,
) -> dict:
    """
    Run the 3-stage LLM pipeline synchronously.
    Used by both the sync endpoint and the ARQ background job.
    """
    packet = _fetch_packet(case_id, packet_kind, tenant_id, trace_id)

    data_quality = packet.get("data_quality") or {}
    if bool(data_quality.get("blocking")):
        return {
            "case_id": case_id,
            "blocked": True,
            "data_quality": data_quality,
        }

    result: dict = {
        "case_id": case_id,
        "draft_openai_json": None,
        "claude_review_json": None,
        "gemini_gate": None,
        "final_narrative_json": None,
        "human_review_required": True,
        "stage_errors": [],
    }

    # Stage 1 — Draft (OpenAI)
    try:
        draft = generate_draft(packet)
        result["draft_openai_json"] = draft
    except Exception as e:
        result["stage_errors"].append({"stage": "openai_draft", "error": str(e)})
        return result

    # Stage 2 — Review (Claude)
    try:
        claude_revised = review_narrative(result["draft_openai_json"])
        if not isinstance(claude_revised, dict):
            raise ValueError(
                f"Claude reviewer returned non-JSON type: {type(claude_revised).__name__}"
            )
        result["claude_review_json"] = claude_revised
    except Exception as e:
        result["stage_errors"].append({"stage": "claude_review", "error": str(e)})
        result["claude_review_json"] = result["draft_openai_json"]

    # Stage 3 — Gate (Gemini)
    try:
        gem = gate(packet, result["claude_review_json"])
        result["gemini_gate"] = gem
        approved = bool(gem.get("approved", False))
        result["final_narrative_json"] = result["claude_review_json"] if approved else None
        result["human_review_required"] = not approved
    except Exception as e:
        result["stage_errors"].append({"stage": "gemini_gate", "error": str(e)})
        result["human_review_required"] = True
        result["final_narrative_json"] = None

    return result


@router.post("/cases/{case_id}/narrative/pipeline")
@_limiter.limit("10/minute")
def run_pipeline(
    request: Request,
    case_id: str,
    packet_kind: Literal["legacy", "cbam"] = "legacy",
    auth_context: AuthContext = Depends(require_scopes(["narrative:run"])),
):
    tenant_id = auth_context.tenant_id
    trace_id: str | None = getattr(request.state, "request_id", None)

    data_quality_raw = None

    pipeline_active.inc()
    try:
        result = _run_pipeline_stages(
            case_id=case_id,
            packet_kind=packet_kind,
            tenant_id=tenant_id,
            trace_id=trace_id,
        )
    finally:
        pipeline_active.dec()

    # Surface blocking response as 422
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
    Enqueue the 3-stage LLM pipeline as a background job.
    Returns immediately with a job_id for polling via GET /api/narrative/jobs/{job_id}.
    Falls back to synchronous execution when Redis is not configured.
    """
    from narrative_app.core.redis_pool import get_redis_pool, REDIS_URL

    tenant_id = auth_context.tenant_id
    trace_id: str | None = getattr(request.state, "request_id", None)

    if not REDIS_URL:
        # No Redis — run synchronously and return result inline
        pipeline_active.inc()
        try:
            result = _run_pipeline_stages(
                case_id=case_id,
                packet_kind=packet_kind,
                tenant_id=tenant_id,
                trace_id=trace_id,
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
            tenant_id=tenant_id,
            trace_id=trace_id,
        )
        return {"job_id": job.job_id if job else None, "status": "queued"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to enqueue job: {e}")
