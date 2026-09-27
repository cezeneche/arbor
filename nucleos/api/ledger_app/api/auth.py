from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from shared_auth import create_access_token, is_dev_token_endpoint_enabled

router = APIRouter(prefix="/auth", tags=["auth"])

_DEFAULT_SCOPES = ["cbam:read", "cbam:write", "narrative:run", "review:write"]


class DevTokenRequest(BaseModel):
    sub: Optional[str] = "dev-user"
    tenant_id: Optional[str] = "dev-org"
    scopes: Optional[List[str]] = None


@router.post("/token")
def issue_dev_token(body: DevTokenRequest = DevTokenRequest()):
    if not is_dev_token_endpoint_enabled():
        raise HTTPException(status_code=404, detail="Not Found")

    token, expires_in = create_access_token(
        sub=body.sub or "dev-user",
        tenant_id=body.tenant_id or "dev-org",
        org_id=body.tenant_id or "dev-org",
        scopes=body.scopes if body.scopes is not None else _DEFAULT_SCOPES,
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
    }



