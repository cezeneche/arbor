from __future__ import annotations

import os

import pytest

from shared_auth.testing import make_test_token

os.environ.setdefault("JWT_SECRET", "test-jwt-secret-for-testing-only-32b")
os.environ.setdefault("JWT_ISSUER", "scope3-agentic")
os.environ.setdefault("JWT_AUDIENCE", "scope3-clients")
os.environ.setdefault("JWT_EXPIRES_SECONDS", "3600")
os.environ.setdefault("AUTH_DEV_TOKEN_ENDPOINT", "true")


@pytest.fixture()
def make_auth_headers():
    def _make(
        *,
        sub: str = "test-user",
        tenant_id: str = "test-tenant",
        scopes: list[str] | None = None,
    ) -> dict[str, str]:
        token = make_test_token(
            sub=sub,
            tenant_id=tenant_id,
            scopes=scopes or [],
        )
        return {"Authorization": f"Bearer {token}"}

    return _make
