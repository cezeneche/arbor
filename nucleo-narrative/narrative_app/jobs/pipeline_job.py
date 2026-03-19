"""
ARQ background job: runs the narrative pipeline and stores the result in Redis.
The job is enqueued by POST /api/cases/{id}/narrative/pipeline/async.
Result is polled via GET /api/narrative/jobs/{job_id}.
"""
from __future__ import annotations

import asyncio
import json
import os
import types


async def run_pipeline_job(
    ctx: dict,
    *,
    case_id: str,
    packet_kind: str,
    tenant_id: str,
    trace_id: str | None,
) -> dict:
    """
    ARQ job entry point.
    Runs the sync pipeline stages in a thread pool and caches the result in Redis.

    Imports run_pipeline_stages from app.services.narrative (the consolidated
    nucleos-api service), not from narrative_app.api.pipeline. A synthetic
    request-like object is built so run_pipeline_stages can access tenant_id
    without an active HTTP request.
    """
    from app.services.narrative import run_pipeline_stages
    from shared_auth.models import AuthContext

    # Build a minimal request-like object so run_pipeline_stages can read
    # request.state.auth_context.tenant_id without an active ASGI request.
    auth_ctx = AuthContext(
        sub="narrative-worker",
        tenant_id=tenant_id,
        scopes=["cbam:read", "narrative:run"],
        jti="worker-internal",
        exp=9_999_999_999,
    )
    state = types.SimpleNamespace(auth_context=auth_ctx, request_id=trace_id)
    synthetic_request = types.SimpleNamespace(state=state)

    result = await asyncio.to_thread(
        run_pipeline_stages,
        case_id=case_id,
        packet_kind=packet_kind,
        request=synthetic_request,
    )

    job_id = ctx.get("job_id", "unknown")

    redis = ctx.get("redis")
    if redis is not None:
        await redis.setex(
            f"job:{job_id}:result",
            86400,
            json.dumps(result),
        )

    # Slack notification — never raises, never delays result delivery
    try:
        from narrative_app.services.slack_notifier import notify_pipeline

        await notify_pipeline(case_id, job_id, success=True, result=result)
    except Exception:
        pass

    return result


class WorkerSettings:
    """ARQ worker configuration."""

    redis_settings = None  # resolved at import time below
    functions = [run_pipeline_job]
    max_jobs = int(os.getenv("ARQ_MAX_JOBS", "10"))

    @classmethod
    def get_redis_settings(cls):
        from narrative_app.core.redis_pool import REDIS_URL
        if not REDIS_URL:
            return None
        try:
            from arq.connections import RedisSettings
            return RedisSettings.from_dsn(REDIS_URL)
        except Exception:
            return None


# Resolve redis_settings at module import so ARQ can pick it up
WorkerSettings.redis_settings = WorkerSettings.get_redis_settings()
