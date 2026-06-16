from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")

import ledger_app.api.cbam as cbam_api


class _Result:
    def __init__(self, rows=None, scalar=None):
        self._rows = rows or []
        self._scalar = scalar

    def mappings(self):
        return self

    def all(self):
        return self._rows

    def one_or_none(self):
        return self._rows[0] if self._rows else None

    def scalar_one_or_none(self):
        return self._scalar


# Minimal column schema for cbam_cases — intentionally excludes tenant_id so
# that _enforce_tenant_id and _require_case_tenant are no-ops in this test.
_CBAM_CASES_COLUMNS = [
    ("id", "NO", None),
    ("importer_eori", "NO", None),
    ("reporting_year", "NO", None),
    ("reporting_quarter", "NO", None),
    ("status", "NO", "'draft'::text"),
    ("created_at", "NO", "now()"),
]


class FakeConnection:
    def __init__(self):
        self.case_ids: set[str] = set()

    def execute(self, statement, params=None):
        params = params or {}
        sql = str(statement)
        if "FROM information_schema.columns" in sql:
            rows = [
                {"column_name": c, "is_nullable": n, "column_default": d}
                for c, n, d in _CBAM_CASES_COLUMNS
            ]
            return _Result(rows=rows)
        if sql.startswith("SELECT 1 FROM cbam.cbam_cases") and "WHERE id = :id" in sql:
            return _Result(scalar=1 if params["id"] in self.case_ids else None)
        raise AssertionError(f"Unexpected SQL in test: {sql}")


class FakeTx:
    def __init__(self, conn: FakeConnection):
        self.conn = conn

    def __enter__(self):
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeEngine:
    def __init__(self, conn: FakeConnection):
        self.conn = conn

    def begin(self):
        return FakeTx(self.conn)


def _client_with_fake_engine(storage_root: Path, case_id: str) -> TestClient:
    from shared_auth.testing import make_test_token

    conn = FakeConnection()
    conn.case_ids.add(case_id)
    cbam_api.engine = FakeEngine(conn)
    cbam_api.CBAM_STORAGE_ROOT = storage_root

    token = make_test_token(scopes=["cbam:read", "cbam:write"])

    app = FastAPI()
    app.include_router(cbam_api.router, prefix="/api")
    return TestClient(app, headers={"Authorization": f"Bearer {token}"})


def test_cbam_document_ingest_upload_returns_expected_keys(tmp_path: Path, monkeypatch):
    case_id = str(uuid4())
    client = _client_with_fake_engine(tmp_path / "storage" / "cbam", case_id)
    monkeypatch.setattr(
        cbam_api,
        "extract_cbam_document",
        lambda _file_path: {"status": "parsed", "structured": {}, "lines": []},
    )

    response = client.post(
        f"/api/cbam/cases/{case_id}/documents",
        files={"file": ("TEST_invoice.pdf", b"dummy file bytes", "application/pdf")},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["case_id"] == case_id
    assert "document_id" in body
    assert "stored_path" in body
    assert "extraction" in body
    assert body["extraction"]["status"] in {"parsed", "error", "llamaindex_not_available"}
    assert Path(body["stored_path"]).exists()
