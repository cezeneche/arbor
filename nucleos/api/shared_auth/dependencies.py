from __future__ import annotations

import logging
from collections.abc import Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from shared_auth.jwt import decode_access_token
from shared_auth.models import AuthContext
from shared_auth.roles import roles_to_scopes

_log = logging.getLogger("nucleos.auth")

bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_auth_context(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthContext:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized()

    # ── Try OIDC first (activated only when OIDC_JWKS_URL env var is set) ────
    try:
        from shared_auth.oidc import try_decode_oidc_token
        oidc_ctx = try_decode_oidc_token(credentials.credentials)
        if oidc_ctx is not None:
            # Merge role-implied scopes into the token's explicit scopes
            oidc_ctx.scopes = list(set(oidc_ctx.scopes) | roles_to_scopes(oidc_ctx.roles))
            request.state.auth_context = oidc_ctx
            return oidc_ctx
    except ImportError:
        pass  # OIDC module not installed / not configured — fall through to HS256
    except Exception as exc:
        # A revoked token, untrusted signing key, expired token, or JWKS fetch
        # failure all land here. The request still falls through to HS256 (and
        # will end up 401 if that also fails), but the security event must not
        # be silently discarded — without this log, revocations are invisible.
        _log.warning("OIDC token validation failed, falling through to HS256: %s", exc)

    # ── Fall back to internal HS256 JWT ───────────────────────────────────────
    try:
        context = decode_access_token(credentials.credentials)
    except ValueError:
        raise _unauthorized()

    # Merge role-implied scopes
    context.scopes = list(set(context.scopes) | roles_to_scopes(context.roles))
    request.state.auth_context = context
    return context


def require_scopes(required_scopes: list[str]) -> Callable[[AuthContext], AuthContext]:
    def _dependency(auth: AuthContext = Depends(get_auth_context)) -> AuthContext:
        current_scopes = set(auth.scopes)
        missing = [scope for scope in required_scopes if scope not in current_scopes]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden",
            )
        return auth

    return _dependency
