from fastapi import FastAPI
from app.api.health import router as health_router
from app.api.db_check import router as db_check_router
from app.api.storage_check import router as storage_check_router
from app.api.llama_test import router as llama_test_router
from app.api.cases import router as cases_router
from app.api.documents import router as documents_router
from app.api.case_index import router as case_index_router
from app.api.extract import router as extract_router
from app.api.calculate import router as calculate_router
from app.api.bundle import router as bundle_router
from app.api.gaps import router as gaps_router
from app.api.resolve import router as resolve_router
from app.api.report_package import router as report_package_router
from app.api.cbam import router as cbam_router

app = FastAPI(title="núcleo ledger", version="0.1.0")

app.include_router(health_router, prefix="/api")
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
