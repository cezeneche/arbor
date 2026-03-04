from __future__ import annotations

from pathlib import Path
import sys

from starlette.testclient import TestClient

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from narrative_app.main import app
from narrative_app.services.ledger_client import LedgerClientError
from shared_auth.testing import make_test_token


client = TestClient(
    app,
    headers={
        "Authorization": f"Bearer {make_test_token(scopes=['narrative:run'])}",
    },
)


def test_pipeline_returns_structured_ledger_error(monkeypatch):
    from narrative_app.api import pipeline as pipeline_module

    def _raise_ledger_error(_case_id: str, **kwargs):
        raise LedgerClientError(
            code="invalid_response",
            message="Ledger returned malformed payload",
            url="http://ledger.local/api/cases/CASE-123/report-package",
            status_code=200,
            body="<bad-json>",
        )

    monkeypatch.setattr(pipeline_module, "fetch_report_package", _raise_ledger_error)

    response = client.post("/api/cases/CASE-123/narrative/pipeline")
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail["error_code"] == "invalid_response"
    assert detail["case_id"] == "CASE-123"
    assert detail["upstream"]["code"] == "invalid_response"
