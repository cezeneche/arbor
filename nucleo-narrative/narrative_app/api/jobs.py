"""
Job status endpoint — stub (async job queue removed).

All pipeline execution is now synchronous. This router is retained so the
module can be imported without error; the endpoint returns 410 Gone to signal
that async jobs are no longer supported.
"""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/narrative/jobs/{job_id}")
async def get_job_status(job_id: str):
    """
    Async pipeline jobs have been removed.

    Use POST /api/cases/{case_id}/narrative/pipeline for synchronous execution.
    """
    return JSONResponse(
        status_code=410,
        content={
            "detail": "Async job queue removed. Use the synchronous pipeline endpoint.",
            "job_id": job_id,
        },
    )
