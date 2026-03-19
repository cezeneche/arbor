import logging
import os
from uuid import uuid4

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from narrative_app.core.config import optional_provider_warnings, validate_startup_config
from shared_auth import get_auth_context
from narrative_app.api.auth import public_router as auth_public_router
from narrative_app.api.auth import protected_router as auth_protected_router
from narrative_app.api.health import router as health_router
from narrative_app.api.pipeline import router as pipeline_router
from narrative_app.api.cbam_compliance import router as cbam_compliance_router
from narrative_app.api.jobs import router as jobs_router

# ── Standard Python logging → stdout ──────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler()],
)
logging.root.setLevel(logging.INFO)

validate_startup_config()

app = FastAPI(title="núcleo narrative", version="0.1.0")

# ── OpenTelemetry distributed tracing (no-op when OTLP_ENDPOINT absent) ──────
from narrative_app.core.telemetry import setup_telemetry
setup_telemetry(app)

# ── HTTPS redirect (production) ───────────────────────────────────────────────
if os.getenv("FORCE_HTTPS", "").strip().lower() in ("1", "true", "yes"):
    from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
    app.add_middleware(HTTPSRedirectMiddleware)

request_logger = logging.getLogger("narrative.request_id")
config_logger = logging.getLogger("narrative.config")

for warning in optional_provider_warnings():
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

app.include_router(health_router, prefix="/api")
app.include_router(health_router)
app.include_router(auth_public_router)
app.include_router(auth_protected_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(pipeline_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(cbam_compliance_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(jobs_router, prefix="/api", dependencies=[Depends(get_auth_context)])

@app.get("/")
def root():
    return {"service": "nucleo-narrative", "status": "ok"}
