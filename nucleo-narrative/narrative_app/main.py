import logging
from uuid import uuid4

from fastapi import FastAPI, Request
from narrative_app.core.config import optional_provider_warnings, validate_startup_config
from narrative_app.api.health import router as health_router
from narrative_app.api.pipeline import router as pipeline_router
from narrative_app.api.cbam_compliance import router as cbam_compliance_router

validate_startup_config()

app = FastAPI(title="núcleo narrative", version="0.1.0")
request_logger = logging.getLogger("narrative.request_id")
config_logger = logging.getLogger("narrative.config")

for warning in optional_provider_warnings():
    config_logger.warning(warning)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id") or str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    request_logger.info(
        "request_id=%s method=%s path=%s status=%s",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
    )
    return response

app.include_router(health_router, prefix="/api")
app.include_router(health_router)
app.include_router(pipeline_router, prefix="/api")
app.include_router(cbam_compliance_router, prefix="/api")

@app.get("/")
def root():
    return {"service": "nucleo-narrative", "status": "ok"}
