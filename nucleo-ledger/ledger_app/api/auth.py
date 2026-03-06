from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from shared_auth import AuthContext, create_access_token, get_auth_context, is_dev_token_endpoint_enabled
from shared_auth.dependencies import require_scopes

router = APIRouter(prefix="/auth", tags=["auth"])
protected_router = APIRouter(prefix="/auth", tags=["auth"])
_limiter = Limiter(key_func=get_remote_address)

_DEFAULT_SCOPES = ["cbam:read", "cbam:write"]


class DevTokenRequest(BaseModel):
    sub: Optional[str] = "dev-user"
    tenant_id: Optional[str] = "dev-org"
    scopes: Optional[List[str]] = None


@router.post("/token")
@_limiter.limit("20/minute")
def issue_dev_token(request: Request, body: DevTokenRequest = DevTokenRequest()):
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


@protected_router.get("/context")
def auth_context(context: AuthContext = Depends(get_auth_context)):
    return context.model_dump(mode="json")


@protected_router.get("/scope-check", dependencies=[Depends(require_scopes(["auth:test"]))])
def scope_check():
    return {"ok": True}
