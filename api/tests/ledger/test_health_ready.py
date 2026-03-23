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
