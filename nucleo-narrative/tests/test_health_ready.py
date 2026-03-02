from __future__ import annotations

from starlette.testclient import TestClient

import narrative_app.api.health as health_api
from narrative_app.main import app


client = TestClient(app)


def test_health_always_200():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["service"] == "nucleo-narrative"


def test_ready_returns_200_when_ledger_reachable(monkeypatch):
    monkeypatch.setattr(health_api, "_check_ledger_reachable", lambda _base_url, timeout_s=1.5: (True, None))

    response = client.get("/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is True
    assert body["dependencies"]["ledger"] == "ok"


def test_ready_returns_503_when_ledger_unreachable(monkeypatch):
    monkeypatch.setattr(
        health_api,
        "_check_ledger_reachable",
        lambda _base_url, timeout_s=1.5: (False, "connection_refused"),
    )

    response = client.get("/ready")
    assert response.status_code == 503
    body = response.json()
    assert body["ready"] is False
    assert body["dependencies"]["ledger"] == "unreachable"
    assert body["detail"] == "connection_refused"
