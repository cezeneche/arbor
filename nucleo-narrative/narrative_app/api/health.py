from fastapi import APIRouter
from fastapi.responses import JSONResponse

from narrative_app.core.config import settings

router = APIRouter()


def _check_ledger_reachable(base_url: str, timeout_s: float = 1.5) -> tuple[bool, str | None]:
    try:
        import httpx
    except Exception:
        return False, "httpx_not_available"

    url = f"{base_url.rstrip('/')}/health"
    try:
        response = httpx.get(url, timeout=timeout_s)
    except Exception as exc:
        return False, str(exc)

    if 200 <= response.status_code < 300:
        return True, None
    return False, f"ledger_health_http_{response.status_code}"


@router.get("/health")
def health():
    return {"service": "nucleo-narrative", "status": "ok"}


@router.get("/ready")
def ready():
    ok, reason = _check_ledger_reachable(settings.ledger_base_url)
    if ok:
        return {
            "ready": True,
            "service": "nucleo-narrative",
            "dependencies": {"ledger_url": settings.ledger_base_url, "ledger": "ok"},
        }
    return JSONResponse(
        status_code=503,
        content={
            "ready": False,
            "service": "nucleo-narrative",
            "dependencies": {"ledger_url": settings.ledger_base_url, "ledger": "unreachable"},
            "detail": reason or "ledger_not_reachable",
        },
    )

@router.get("/health/ready")
def health_ready():
    return {"ok": True, "service": "nucleo-narrative", "ready": True}
