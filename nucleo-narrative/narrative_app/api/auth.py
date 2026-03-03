from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from shared_auth import AuthContext, create_access_token, get_auth_context, is_dev_token_endpoint_enabled
from shared_auth.dependencies import require_scopes

public_router = APIRouter(tags=["auth"])
protected_router = APIRouter(prefix="/auth", tags=["auth"])


class DevTokenRequest(BaseModel):
    sub: str = Field(..., min_length=1)
    tenant_id: str = Field(..., min_length=1)
    scopes: list[str] = Field(default_factory=list)


@public_router.post("/auth/token")
def issue_dev_token(payload: DevTokenRequest):
    if not is_dev_token_endpoint_enabled():
        raise HTTPException(status_code=404, detail="Not Found")

    token, expires_in = create_access_token(
        sub=payload.sub,
        tenant_id=payload.tenant_id,
        scopes=payload.scopes,
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
