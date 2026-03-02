from __future__ import annotations

import logging
from pathlib import Path
import sys
from uuid import UUID

from starlette.testclient import TestClient

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from narrative_app.main import app


client = TestClient(app)


def test_request_id_echoes_provided_header(caplog):
    request_id = "req-narrative-123"
    caplog.set_level(logging.INFO, logger="narrative.request_id")

    response = client.get("/health", headers={"X-Request-Id": request_id})

    assert response.status_code == 200
    assert response.headers.get("X-Request-Id") == request_id
    assert any(request_id in rec.getMessage() for rec in caplog.records)


def test_request_id_generated_when_missing(caplog):
    caplog.set_level(logging.INFO, logger="narrative.request_id")

    response = client.get("/health")

    assert response.status_code == 200
    generated = response.headers.get("X-Request-Id")
    assert generated is not None
    UUID(generated)
    assert any(generated in rec.getMessage() for rec in caplog.records)
