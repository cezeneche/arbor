from __future__ import annotations

import os
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import create_client

from shared_auth import AuthContext, create_access_token, get_auth_context, is_dev_token_endpoint_enabled
from shared_auth.dependencies import require_scopes

router = APIRouter(prefix="/auth", tags=["auth"])
protected_router = APIRouter(prefix="/auth", tags=["auth"])

_DEFAULT_SCOPES = ["cbam:read", "cbam:write", "narrative:run", "review:write"]
_SUPABASE_URL = os.getenv("SUPABASE_URL", "")
_SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


class DevTokenRequest(BaseModel):
    sub: Optional[str] = "dev-user"
    tenant_id: Optional[str] = "dev-org"
    scopes: Optional[List[str]] = None


class SupabaseTokenRequest(BaseModel):
    access_token: str


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


@router.post("/supabase")
def supabase_exchange(body: SupabaseTokenRequest):
    if not _SUPABASE_URL or not _SUPABASE_SERVICE_KEY:
        raise HTTPException(status_code=503, detail="Supabase not configured")

    try:
        client = create_client(_SUPABASE_URL, _SUPABASE_SERVICE_KEY)
        response = client.auth.get_user(body.access_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    if not response.user:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = response.user
    tenant_id = str(user.id)
    email = user.email or tenant_id

    token, expires_in = create_access_token(
        sub=email,
        tenant_id=tenant_id,
        org_id=tenant_id,
        scopes=_DEFAULT_SCOPES,
    )
    return {"access_token": token, "token_type": "bearer", "expires_in": expires_in}


@protected_router.get("/context")
def auth_context(context: AuthContext = Depends(get_auth_context)):
    return context.model_dump(mode="json")


@protected_router.get("/scope-check", dependencies=[Depends(require_scopes(["auth:test"]))])
def scope_check():
    return {"ok": True}
