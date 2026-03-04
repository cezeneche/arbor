from fastapi import APIRouter, Request
from slowapi import Limiter
from ledger_app.core.rate_limit import user_or_ip_key
from ledger_app.services.storage import s3_healthcheck, upload_text

router = APIRouter()
_limiter = Limiter(key_func=user_or_ip_key)

@router.get("/storage-check")
def storage_check():
    return s3_healthcheck()

@router.post("/storage-test-upload")
@_limiter.limit("10/minute")
def storage_test_upload(request: Request):
    key = "healthcheck/nucleo_test.txt"
    uri = upload_text(key, "hello from nucleo")
    return {"uploaded": True, "uri": uri}
