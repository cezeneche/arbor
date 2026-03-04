import logging
import os
from uuid import uuid4

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pythonjsonlogger.json import JsonFormatter as _JsonFormatter
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy.exc import OperationalError, ProgrammingError
from prometheus_fastapi_instrumentator import Instrumentator
from ledger_app.core.config import optional_startup_warnings, validate_startup_config
from ledger_app.core.rate_limit import user_or_ip_key
from shared_auth import get_auth_context

# ── Structured JSON logging ────────────────────────────────────────────────────
_json_handler = logging.StreamHandler()
_json_handler.setFormatter(
    _JsonFormatter("%(asctime)s %(name)s %(levelname)s %(message)s")
)
logging.root.addHandler(_json_handler)
logging.root.setLevel(logging.INFO)

validate_startup_config()

app = FastAPI(title="núcleo ledger", version="0.1.0")

# ── OpenTelemetry distributed tracing (no-op when OTLP_ENDPOINT absent) ──────
from ledger_app.core.telemetry import setup_telemetry
setup_telemetry(app)

# ── HTTPS redirect (production) ───────────────────────────────────────────────
if os.getenv("FORCE_HTTPS", "").strip().lower() in ("1", "true", "yes"):
    from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
    app.add_middleware(HTTPSRedirectMiddleware)

# ── Idempotency middleware (active only when REDIS_URL is set) ─────────────────
from ledger_app.middleware.idempotency import IdempotencyMiddleware
app.add_middleware(IdempotencyMiddleware)

# ── Prometheus metrics ─────────────────────────────────────────────────────────
Instrumentator().instrument(app).expose(app, endpoint="/metrics")
limiter = Limiter(key_func=user_or_ip_key)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
request_logger = logging.getLogger("ledger.request_id")
config_logger = logging.getLogger("ledger.config")

for warning in optional_startup_warnings():
    config_logger.warning(warning)


_MAX_REQUEST_SIZE = int(os.getenv("MAX_REQUEST_SIZE_BYTES", str(10 * 1024 * 1024)))


@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_REQUEST_SIZE:
        return JSONResponse(status_code=413, content={"detail": "Request too large"})
    return await call_next(request)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id") or str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    auth_context = getattr(request.state, "auth_context", None)
    sub = getattr(auth_context, "sub", "-")
    tenant_id = getattr(auth_context, "tenant_id", "-")
    request_logger.info(
        "request_id=%s method=%s path=%s status=%s sub=%s tenant_id=%s",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        sub,
        tenant_id,
    )
    return response


@app.exception_handler(OperationalError)
@app.exception_handler(ProgrammingError)
async def db_error_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "-")
    request_logger.error("request_id=%s db_error=%s", request_id, str(exc))
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


from ledger_app.api.health import router as health_router
from ledger_app.api.auth import router as auth_router
from ledger_app.api.auth import protected_router as auth_protected_router
from ledger_app.api.db_check import router as db_check_router
from ledger_app.api.storage_check import router as storage_check_router
from ledger_app.api.llama_test import router as llama_test_router
from ledger_app.api.cases import router as cases_router
from ledger_app.api.documents import router as documents_router
from ledger_app.api.case_index import router as case_index_router
from ledger_app.api.extract import router as extract_router
from ledger_app.api.calculate import router as calculate_router
from ledger_app.api.bundle import router as bundle_router
from ledger_app.api.gaps import router as gaps_router
from ledger_app.api.resolve import router as resolve_router
from ledger_app.api.report_package import router as report_package_router
from ledger_app.api.cbam import router as cbam_router
from ledger_app.api.audit import router as audit_router

app.include_router(health_router, prefix="/api")
app.include_router(health_router)
app.include_router(auth_router, prefix="/api")
app.include_router(auth_protected_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(db_check_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(storage_check_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(llama_test_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(cases_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(documents_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(case_index_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(extract_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(calculate_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(bundle_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(gaps_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(resolve_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(report_package_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(cbam_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(audit_router, prefix="/api", dependencies=[Depends(get_auth_context)])

@app.get("/")
def root():
    return {"service": "nucleo-ledger", "status": "ok"}
