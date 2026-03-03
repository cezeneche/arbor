from __future__ import annotations

from shared_auth.jwt import create_access_token


def make_test_token(
    *,
    sub: str = "test-user",
    tenant_id: str = "test-tenant",
    scopes: list[str] | None = None,
    expires_seconds: int = 3600,
) -> str:
    token, _ = create_access_token(
        sub=sub,
        tenant_id=tenant_id,
        scopes=scopes or [],
        expires_seconds=expires_seconds,
    )
    return token
