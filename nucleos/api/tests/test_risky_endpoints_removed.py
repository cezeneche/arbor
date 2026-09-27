"""Routes the 27 September endpoint audit flagged as risk rather than clutter.

Each was reachable in production and used by nothing Arbor runs:

- the API docs published the whole route table to anyone;
- a Supabase-session exchange minted Nucleos tokens for the web app that has
  since been removed;
- a storage test wrote a file in production, where Nucleos holds no documents;
- the dev token issuer was one environment variable away from open.

See docs/audits/2026-09-27-nucleos-endpoints.md.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def _paths() -> set[str]:
    return {getattr(r, "path", "") for r in app.routes}


def test_the_api_docs_are_not_published():
    for path in ("/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404, path


def test_the_supabase_session_exchange_is_gone():
    assert "/api/auth/supabase" not in _paths()


def test_the_storage_test_upload_is_gone():
    assert "/api/storage-test-upload" not in _paths()


def test_the_dev_token_is_refused_on_a_vercel_production_deployment(monkeypatch):
    monkeypatch.setenv("AUTH_DEV_TOKEN_ENDPOINT", "true")
    monkeypatch.setenv("VERCEL_ENV", "production")
    assert client.post("/api/auth/token").status_code == 404


def test_the_dev_token_is_refused_when_the_environment_is_production(monkeypatch):
    monkeypatch.setenv("AUTH_DEV_TOKEN_ENDPOINT", "true")
    monkeypatch.delenv("VERCEL_ENV", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert client.post("/api/auth/token").status_code == 404


def test_the_dev_token_still_works_locally_when_enabled(monkeypatch):
    # The boundary check and the demo scripts rely on it.
    monkeypatch.setenv("AUTH_DEV_TOKEN_ENDPOINT", "true")
    monkeypatch.delenv("VERCEL_ENV", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "development")
    assert client.post("/api/auth/token").status_code == 200
