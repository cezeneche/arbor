"""
Role-based access control for the scope3-agentic platform.

Roles are carried in the JWT `roles` claim and automatically expand to scopes
inside get_auth_context(). Fine-grained per-endpoint checks can use either:

    Depends(require_scopes(["cbam:write"]))   # scope-level (existing)
    Depends(require_roles(["admin", "analyst"]))  # role-level (new)
"""
from __future__ import annotations

from collections.abc import Callable
from enum import Enum

from fastapi import Depends, HTTPException, status

from shared_auth.models import AuthContext


class Role(str, Enum):
    ADMIN = "admin"
    ANALYST = "analyst"
    VIEWER = "viewer"
    SERVICE = "service"


# Scopes automatically granted to each role.
ROLE_SCOPES: dict[str, set[str]] = {
    Role.ADMIN:   {"cbam:read", "cbam:write", "cbam:admin", "narrative:run", "auth:test"},
    Role.ANALYST: {"cbam:read", "cbam:write", "narrative:run"},
    Role.VIEWER:  {"cbam:read"},
    Role.SERVICE: {"cbam:read", "narrative:run"},
}


def roles_to_scopes(roles: list[str]) -> set[str]:
    """Return the union of all scopes implied by the given role names."""
    result: set[str] = set()
    for role in roles:
        result |= ROLE_SCOPES.get(role, set())
    return result


def require_roles(required_roles: list[str]) -> Callable[[AuthContext], AuthContext]:
    """FastAPI dependency: raises 403 unless the caller has at least one of the required roles."""
    from shared_auth.dependencies import get_auth_context  # local import to avoid circular

    def _dependency(auth: AuthContext = Depends(get_auth_context)) -> AuthContext:
        caller_roles = set(auth.roles)
        if not caller_roles.intersection(required_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: insufficient role",
            )
        return auth

    return _dependency
