from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ledger_app.db.session import db_healthcheck

router = APIRouter()

@router.get("/health")
def health():
    return {"ok": True, "service": "nucleo-ledger"}


@router.get("/ready")
def ready():
    try:
        db_state = db_healthcheck()
        if bool(db_state.get("db_ok")):
            return {
                "ready": True,
                "service": "nucleo-ledger",
                "dependencies": {"db": "ok"},
            }
        return JSONResponse(
            status_code=503,
            content={
                "ready": False,
                "service": "nucleo-ledger",
                "dependencies": {"db": "unhealthy"},
            },
        )
    except Exception as exc:
        return JSONResponse(
            status_code=503,
            content={
                "ready": False,
                "service": "nucleo-ledger",
                "dependencies": {"db": "unreachable"},
                "detail": str(exc),
            },
        )

@router.get("/health/ready")
def health_ready():
    return {"ok": True, "service": "nucleo-ledger", "ready": True}
