import logging
from uuid import uuid4

from fastapi import FastAPI, Request
from ledger_app.core.config import optional_startup_warnings, validate_startup_config

validate_startup_config()

app = FastAPI(title="núcleo ledger", version="0.1.0")
request_logger = logging.getLogger("ledger.request_id")
config_logger = logging.getLogger("ledger.config")

for warning in optional_startup_warnings():
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

from ledger_app.api.health import router as health_router
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

app.include_router(health_router, prefix="/api")
app.include_router(health_router)
app.include_router(db_check_router, prefix="/api")
app.include_router(storage_check_router, prefix="/api")
app.include_router(llama_test_router, prefix="/api")
app.include_router(cases_router, prefix="/api")
app.include_router(documents_router, prefix="/api")
app.include_router(case_index_router, prefix="/api")
app.include_router(extract_router, prefix="/api")
app.include_router(calculate_router, prefix="/api")
app.include_router(bundle_router, prefix="/api")
app.include_router(gaps_router, prefix="/api")
app.include_router(resolve_router, prefix="/api")
app.include_router(report_package_router, prefix="/api")
app.include_router(cbam_router, prefix="/api")

@app.get("/")
def root():
    return {"service": "nucleo-ledger", "status": "ok"}
