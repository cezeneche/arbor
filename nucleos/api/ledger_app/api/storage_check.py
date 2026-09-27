from fastapi import APIRouter
from ledger_app.services.storage import s3_healthcheck

router = APIRouter(tags=["infrastructure"])

@router.get("/storage-check")
def storage_check():
    return s3_healthcheck()
