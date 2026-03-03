from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

from starlette.testclient import TestClient

from narrative_app.main import app
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
        "scopes": ["narrative:run"],
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


def test_api_requires_token():
    response = client.post("/api/cases/CASE-1/narrative/pipeline")
    assert response.status_code == 401


def test_api_accepts_valid_token(monkeypatch):
    from narrative_app.api import pipeline as pipeline_module

    monkeypatch.setattr(pipeline_module, "fetch_report_package", lambda _case_id: {"type": "report_package_v1"})
    monkeypatch.setattr(
        pipeline_module,
        "generate_draft",
        lambda _packet: {
            "executive_summary": "ok",
            "methodology": "ok",
            "results": {},
            "limitations": "ok",
            "open_gaps": [],
        },
    )
    monkeypatch.setattr(pipeline_module, "review_narrative", lambda draft: draft)
    monkeypatch.setattr(pipeline_module, "gate", lambda _packet, _narrative: {"approved": True, "issues": []})

    token = make_test_token(sub="alice", tenant_id="tenant-narrative", scopes=["narrative:run"])
    response = client.post("/api/cases/CASE-1/narrative/pipeline", headers=_auth_header(token))
    assert response.status_code == 200


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


def test_pipeline_scope_enforced(monkeypatch):
    from narrative_app.api import pipeline as pipeline_module

    monkeypatch.setattr(pipeline_module, "fetch_report_package", lambda _case_id: {"type": "report_package_v1"})

    token = make_test_token(sub="alice", tenant_id="tenant-narrative", scopes=[])
    response = client.post("/api/cases/CASE-1/narrative/pipeline", headers=_auth_header(token))
    assert response.status_code == 403
