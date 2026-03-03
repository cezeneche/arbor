from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from shared_auth import AuthContext, create_access_token, get_auth_context, is_dev_token_endpoint_enabled
from shared_auth.dependencies import require_scopes

router = APIRouter(prefix="/auth", tags=["auth"])
protected_router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/token")
def issue_dev_token():
    if not is_dev_token_endpoint_enabled():
        raise HTTPException(status_code=404, detail="Not Found")

    token, expires_in = create_access_token(
        sub="dev-user",
        tenant_id="dev-org",
        org_id="dev-org",
        scopes=["cbam:read", "cbam:write"],
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
