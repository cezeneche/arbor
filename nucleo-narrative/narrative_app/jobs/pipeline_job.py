"""
ARQ background job: runs the 3-stage LLM pipeline and stores the result in Redis.
The job is enqueued by POST /api/cases/{id}/narrative/pipeline/async.
Result is polled via GET /api/narrative/jobs/{job_id}.
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any


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
    """
    from narrative_app.api.pipeline import _run_pipeline_stages

    result = await asyncio.to_thread(
        _run_pipeline_stages,
        case_id=case_id,
        packet_kind=packet_kind,
        tenant_id=tenant_id,
        trace_id=trace_id,
    )

    redis = ctx.get("redis")
    if redis is not None:
        job_id = ctx.get("job_id", "unknown")
        await redis.setex(
            f"job:{job_id}:result",
            86400,
            json.dumps(result),
        )

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
