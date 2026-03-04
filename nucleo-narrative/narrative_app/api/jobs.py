"""
Job status polling endpoint.
GET /api/narrative/jobs/{job_id}
→ {job_id, status: "queued|running|done|failed", result: {...} | null}
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/narrative/jobs/{job_id}")
async def get_job_status(job_id: str):
    """
    Poll the status of an async pipeline job.
    Returns the result when status == "done".
    Returns 503 when Redis is not configured.
    """
    from narrative_app.core.redis_pool import get_redis_pool, REDIS_URL

    if not REDIS_URL:
        raise HTTPException(
            status_code=503,
            detail="Job queue not configured (REDIS_URL not set). Use the synchronous endpoint.",
        )

    redis = get_redis_pool()
    if redis is None:
        raise HTTPException(status_code=503, detail="Redis unavailable.")

    # Check for stored result first
    result_key = f"job:{job_id}:result"
    try:
        cached = await redis.get(result_key)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Redis error: {e}")

    if cached:
        try:
            result = json.loads(cached)
        except Exception:
            result = None
        return JSONResponse({"job_id": job_id, "status": "done", "result": result})

    # Check ARQ job status
    try:
        from arq import create_pool
        from arq.connections import RedisSettings

        arq_pool = await create_pool(RedisSettings.from_dsn(REDIS_URL))
        job = await arq_pool.job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found.")

        job_status = await job.status()
        status_str = job_status.value if hasattr(job_status, "value") else str(job_status)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to query job status: {e}")

    return JSONResponse({"job_id": job_id, "status": status_str, "result": None})
