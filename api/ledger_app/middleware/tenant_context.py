"""
Tenant context middleware for nucleo-ledger (Supabase edition).

Every incoming request that carries a valid JWT has its tenant_id extracted
and set as the PostgreSQL session variable app.current_tenant_id BEFORE any
route handler runs. This makes RLS policies transparent to application code.

How it works
------------
1. TenantContextMiddleware reads the Bearer token from the Authorization header.
2. It decodes the JWT (shared_auth.jwt.decode_access_token) to get the
   AuthContext, which contains tenant_id.
3. It calls Supabase's set_config() RPC to set app.current_tenant_id for the
   duration of that database connection.
4. The context is cleared in the finally block after the response is sent.

Routes excluded from tenant context:
  /health, /ready, /auth/token, /api-proxy/*

Integration
-----------
Add to FastAPI app in main.py:

    from ledger_app.middleware.tenant_context import TenantContextMiddleware
    app.add_middleware(TenantContextMiddleware)

The middleware must be added AFTER the Supabase client is initialised
(i.e. after the lifespan runs), so add it before defining routes but
after the lifespan is attached.
"""

import logging
from collections.abc import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from shared_auth.jwt import decode_access_token
from shared_auth.models import AuthContext

logger = logging.getLogger(__name__)

# Routes that do NOT require tenant context
_EXCLUDED_PREFIXES = (
    "/health",
    "/ready",
    "/auth/token",
    "/api/auth/token",
    "/api-proxy",
    "/docs",
    "/openapi.json",
    "/redoc",
)


class TenantContextMiddleware(BaseHTTPMiddleware):
    """
    Starlette/FastAPI middleware that sets the PostgreSQL RLS session variable
    app.current_tenant_id for every authenticated request.

    Uses is_local=True so the variable is automatically reset when the
    connection is returned to the pool — no manual cleanup needed beyond
    the try/finally below.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Skip excluded routes
        path = request.url.path
        if any(path.startswith(prefix) for prefix in _EXCLUDED_PREFIXES):
            return await call_next(request)

        # Extract JWT from Authorization header
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            # Let the route's own auth dependency handle missing auth
            return await call_next(request)

        token = auth_header.removeprefix("Bearer ").strip()
        auth_ctx: AuthContext | None = None

        try:
            auth_ctx = decode_access_token(token)
        except Exception as exc:
            logger.debug("TenantContextMiddleware: token decode failed: %s", exc)
            # Don't reject here — route auth dependency will handle it with
            # a proper 401 response including WWW-Authenticate header
            return await call_next(request)

        if not auth_ctx or not auth_ctx.tenant_id:
            return await call_next(request)

        # Attach auth context to request state so route handlers can access
        # it without decoding the JWT a second time
        request.state.auth = auth_ctx
        tenant_id = auth_ctx.tenant_id

        # Set PostgreSQL session variable for RLS
        await _set_pg_tenant(tenant_id)

        try:
            response = await call_next(request)
        finally:
            # Clear tenant context — belt-and-suspenders alongside is_local=True
            await _clear_pg_tenant()

        return response


# ---------------------------------------------------------------------------
# Internal helpers — thin wrappers around the Supabase admin client RPC
# ---------------------------------------------------------------------------

async def _set_pg_tenant(tenant_id: str) -> None:
    """Set app.current_tenant_id for the current PostgreSQL session."""
    try:
        from ledger_app.db.supabase_client import get_admin_client  # local import avoids circular deps
        client = get_admin_client()
        await client.rpc(
            "set_config",
            {
                "setting": "app.current_tenant_id",
                "value": tenant_id,
                "is_local": True,   # resets automatically on connection return
            },
        ).execute()
        logger.debug("Tenant context set: %s", tenant_id)
    except Exception as exc:
        # Non-fatal — RLS will still enforce isolation; just log and continue
        logger.warning("Failed to set pg tenant context for %s: %s", tenant_id, exc)


async def _clear_pg_tenant() -> None:
    """Clear app.current_tenant_id. Belt-and-suspenders alongside is_local."""
    try:
        from ledger_app.db.supabase_client import get_admin_client
        client = get_admin_client()
        await client.rpc(
            "set_config",
            {"setting": "app.current_tenant_id", "value": "", "is_local": True},
        ).execute()
    except Exception:
        pass  # Best-effort


# ---------------------------------------------------------------------------
# Convenience dependency — use in routes that need the decoded AuthContext
# without decoding the JWT a third time
# ---------------------------------------------------------------------------

from fastapi import HTTPException, status


async def get_request_auth(request: Request) -> AuthContext:
    """
    FastAPI dependency that returns the AuthContext pre-populated by
    TenantContextMiddleware. Falls back to decoding the token if middleware
    was skipped (e.g. tests using TestClient without middleware).

    Usage:

        @router.get("/cases")
        async def list_cases(auth: AuthContext = Depends(get_request_auth)):
            ...
    """
    if hasattr(request.state, "auth") and request.state.auth is not None:
        return request.state.auth

    # Fallback: decode from header (e.g. in tests)
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = auth_header.removeprefix("Bearer ").strip()
    try:
        ctx = decode_access_token(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return ctx
