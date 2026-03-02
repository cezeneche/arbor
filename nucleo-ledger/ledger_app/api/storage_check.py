from fastapi import APIRouter
from ledger_app.services.storage import s3_healthcheck, upload_text

router = APIRouter()

@router.get("/storage-check")
def storage_check():
    return s3_healthcheck()

@router.post("/storage-test-upload")
def storage_test_upload():
    key = "healthcheck/nucleo_test.txt"
    uri = upload_text(key, "hello from nucleo")
    return {"uploaded": True, "uri": uri}
