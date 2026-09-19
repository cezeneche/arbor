from __future__ import annotations

from fastapi.testclient import TestClient

import ledger_app.api.health as health_api
from ledger_app.main import app


client = TestClient(app)


def test_health_always_200():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_ready_returns_200_when_db_ok(monkeypatch):
    monkeypatch.setattr(health_api, "db_healthcheck", lambda: {"db_ok": True})

    response = client.get("/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is True
    assert body["dependencies"]["db"] == "ok"


def test_ready_returns_503_when_db_unreachable(monkeypatch):
    def _raise_error():
        raise RuntimeError("db unavailable")

    monkeypatch.setattr(health_api, "db_healthcheck", _raise_error)

    response = client.get("/ready")
    assert response.status_code == 503
    body = response.json()
    assert body["ready"] is False
    assert body["dependencies"]["db"] == "unreachable"


def test_ready_returns_503_when_required_tables_are_missing(monkeypatch):
    # A database that answers SELECT 1 but lacks the tables the CBAM handoff
    # writes to cannot serve a case. Reporting it ready sent traffic to it.
    monkeypatch.setattr(health_api, "db_healthcheck", lambda: {"db_ok": True})
    monkeypatch.setattr(health_api, "missing_required_tables", lambda: ["cbam.cbam_goods_lines"])

    response = client.get("/ready")
    assert response.status_code == 503
    body = response.json()
    assert body["ready"] is False
    assert body["dependencies"]["schema"] == {"missing": ["cbam.cbam_goods_lines"]}


def test_health_ready_is_the_same_check_as_ready(monkeypatch):
    # /health/ready used to answer ready unconditionally. There is one
    # readiness contract, whichever path a probe is configured with.
    def _raise_error():
        raise RuntimeError("db unavailable")

    monkeypatch.setattr(health_api, "db_healthcheck", _raise_error)
    response = client.get("/health/ready")
    assert response.status_code == 503
    assert response.json()["ready"] is False


def test_ready_reports_schema_ok_when_tables_exist(monkeypatch):
    monkeypatch.setattr(health_api, "db_healthcheck", lambda: {"db_ok": True})
    monkeypatch.setattr(health_api, "missing_required_tables", lambda: [])

    body = client.get("/health/ready").json()
    assert body["ready"] is True
    assert body["dependencies"] == {"db": "ok", "schema": "ok"}


def test_ready_does_not_publish_the_database_error(monkeypatch):
    # /ready is unauthenticated. The driver's error names the database host and
    # the Supabase project; it goes to the log, not to whoever asked.
    def _raise_error():
        raise RuntimeError('connection to server at "db.example.supabase.com" failed: tenant/user postgres.abc not found')

    monkeypatch.setattr(health_api, "db_healthcheck", _raise_error)
    response = client.get("/ready")
    assert response.status_code == 503
    assert "supabase" not in response.text
    assert "detail" not in response.json()
