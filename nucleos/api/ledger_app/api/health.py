import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ledger_app.db.session import db_healthcheck, missing_required_tables

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    return {"ok": True, "service": "nucleo-ledger"}


def _readiness():
    """The one readiness contract: the database answers and has the tables a
    case is written to. /ready and /health/ready both serve it, so a probe
    configured with either path gets the same answer."""
    try:
        db_ok = bool(db_healthcheck().get("db_ok"))
    except Exception:
        # Logged, not returned: this route is unauthenticated, and the driver's
        # error names the database host and project.
        logger.exception("readiness: database unreachable")
        return JSONResponse(
            status_code=503,
            content={
                "ready": False,
                "service": "nucleo-ledger",
                "dependencies": {"db": "unreachable"},
            },
        )
    if not db_ok:
        return JSONResponse(
            status_code=503,
            content={"ready": False, "service": "nucleo-ledger", "dependencies": {"db": "unhealthy"}},
        )

    missing = missing_required_tables()
    if missing:
        return JSONResponse(
            status_code=503,
            content={
                "ready": False,
                "service": "nucleo-ledger",
                "dependencies": {"db": "ok", "schema": {"missing": missing}},
            },
        )
    return {"ready": True, "service": "nucleo-ledger", "dependencies": {"db": "ok", "schema": "ok"}}


@router.get("/ready")
def ready():
    return _readiness()


@router.get("/health/ready")
def health_ready():
    return _readiness()
