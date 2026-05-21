from __future__ import annotations

import logging
from uuid import UUID

from fastapi.testclient import TestClient

from ledger_app.main import app


client = TestClient(app)


def test_request_id_echoes_provided_header(caplog):
    request_id = "req-ledger-123"
    caplog.set_level(logging.INFO, logger="ledger.request_id")

    response = client.get("/health", headers={"X-Request-Id": request_id})

    assert response.status_code == 200
    assert response.headers.get("X-Request-Id") == request_id
    assert any(request_id in rec.getMessage() for rec in caplog.records)


def test_request_id_generated_when_missing(caplog):
    caplog.set_level(logging.INFO, logger="ledger.request_id")

    response = client.get("/health")

    assert response.status_code == 200
    generated = response.headers.get("X-Request-Id")
    assert generated is not None
    UUID(generated)
    assert any(generated in rec.getMessage() for rec in caplog.records)
