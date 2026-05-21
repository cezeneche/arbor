from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from ledger_app.main import app
from shared_auth.jwt import get_jwt_settings
from shared_auth.testing import make_test_token


client = TestClient(app)


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _token_with(*, iss: str | None = None, aud: str | None = None, tenant_id: str | None = "tenant-a") -> str:
    settings = get_jwt_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": "user-a",
        "tenant_id": tenant_id,
        "scopes": [],
        "jti": "jti-test",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
        "iss": iss if iss is not None else settings.issuer,
        "aud": aud if aud is not None else settings.audience,
    }
    return _encode_hs256(payload, settings.secret)


def _encode_hs256(payload: dict, secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}

    def _b64(value: bytes) -> str:
        return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")

    header_b64 = _b64(json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    payload_b64 = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{header_b64}.{payload_b64}.{_b64(signature)}"


def test_health_is_public():
    response = client.get("/health")
    assert response.status_code == 200


def test_dev_token_endpoint_returns_404_when_disabled(monkeypatch):
    monkeypatch.setenv("AUTH_DEV_TOKEN_ENDPOINT", "false")
    response = client.post("/api/auth/token")
    assert response.status_code == 404


def test_dev_token_endpoint_returns_token_when_enabled(monkeypatch):
    monkeypatch.setenv("AUTH_DEV_TOKEN_ENDPOINT", "true")
    response = client.post("/api/auth/token")
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert isinstance(body.get("expires_in"), int) and body["expires_in"] > 0
    token = body["access_token"]
    parts = token.split(".")
    assert len(parts) == 3

    payload_raw = parts[1] + "=" * (-len(parts[1]) % 4)
    payload = json.loads(base64.urlsafe_b64decode(payload_raw).decode("utf-8"))
    assert payload["sub"] == "dev-user"
    assert payload["org_id"] == "dev-org"
    assert payload["scopes"] == ["cbam:read", "cbam:write"]
    assert "iss" in payload and "aud" in payload and "iat" in payload and "exp" in payload


def test_api_requires_token():
    response = client.get("/api/auth/context")
    assert response.status_code == 401


def test_api_accepts_valid_token():
    token = make_test_token(sub="alice", tenant_id="tenant-ledger", scopes=["auth:test"])
    response = client.get("/api/auth/context", headers=_auth_header(token))
    assert response.status_code == 200
    body = response.json()
    assert body["sub"] == "alice"
    assert body["tenant_id"] == "tenant-ledger"


def test_invalid_audience_or_issuer_fails():
    bad_aud = _token_with(aud="wrong-audience")
    bad_iss = _token_with(iss="wrong-issuer")

    response_aud = client.get("/api/auth/context", headers=_auth_header(bad_aud))
    response_iss = client.get("/api/auth/context", headers=_auth_header(bad_iss))

    assert response_aud.status_code == 401
    assert response_iss.status_code == 401


def test_missing_tenant_id_fails():
    token = _token_with(tenant_id=None)
    response = client.get("/api/auth/context", headers=_auth_header(token))
    assert response.status_code == 401


def test_scope_enforcement_works():
    no_scope = make_test_token(sub="bob", tenant_id="tenant-ledger", scopes=[])
    with_scope = make_test_token(sub="bob", tenant_id="tenant-ledger", scopes=["auth:test"])

    denied = client.get("/api/auth/scope-check", headers=_auth_header(no_scope))
    allowed = client.get("/api/auth/scope-check", headers=_auth_header(with_scope))

    assert denied.status_code == 403
    assert allowed.status_code == 200
