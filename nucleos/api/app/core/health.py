"""
Deep health check endpoint for the consolidated API.

GET /api/health/deep — checks database connectivity and Claude API key presence.

Shallow liveness/readiness probes (/health, /ready) are handled by
ledger_app.api.health and are mounted at both / and /api prefixes in main.py.
"""
from __future__ import annotations

import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(tags=["health"])


@router.get("/api/health/deep")
def health_deep():
    """
    Deep health check: verifies database connectivity and Claude API key presence.

    Returns 200 when all checks pass; 503 when any check fails.
    Suitable for alerting and orchestrator liveness probes that need more than
    a process-alive signal.
    """
    checks: dict[str, str] = {}

    # Database — trivial query to confirm pool + schema are reachable
    try:
        from sqlalchemy import text
        from ledger_app.db.session import engine

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {type(exc).__name__}: {exc}"

    # Claude API — verify key is configured (no billable call made)
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    checks["claude"] = "ok" if api_key else "error: ANTHROPIC_API_KEY not set"

    all_ok = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=200 if all_ok else 503,
        content={"status": "ok" if all_ok else "degraded", "checks": checks},
    )
