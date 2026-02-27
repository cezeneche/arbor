from fastapi import FastAPI
from app.api.health import router as health_router
from app.api.pipeline import router as pipeline_router
from app.api.cbam_compliance import router as cbam_compliance_router

app = FastAPI(title="núcleo narrative", version="0.1.0")

app.include_router(health_router, prefix="/api")
app.include_router(pipeline_router, prefix="/api")
app.include_router(cbam_compliance_router, prefix="/api")

@app.get("/")
def root():
    return {"service": "nucleo-narrative", "status": "ok"}
