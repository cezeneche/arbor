from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from shared_auth.jwt import decode_access_token
from shared_auth.models import AuthContext

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

    try:
        context = decode_access_token(credentials.credentials)
    except ValueError:
        raise _unauthorized()

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
