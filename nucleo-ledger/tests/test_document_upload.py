"""Tests for document upload hardening: MIME allowlist, magic-byte validation, batch endpoint."""
from __future__ import annotations

import json
import os
from io import BytesIO
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")

import ledger_app.api.documents as doc_module
from ledger_app.services.document_validator import (
    MAX_BATCH_FILES,
    MAX_FILE_SIZE,
    validate_upload,
)

# ── Magic byte helpers ────────────────────────────────────────────────────────

_PDF_MAGIC = b"%PDF-1.4 fake content"
_XLSX_MAGIC = b"PK\x03\x04fake xlsx content"
_XLS_MAGIC = b"\xd0\xcf\x11\xe0fake xls content"
_XML_CONTENT = b"<?xml version='1.0'?><root/>"
_CSV_CONTENT = b"supplier,cn_code,mass_kg\nAcme,720711,1000\n"
_MZ_MAGIC = b"MZ\x90\x00fake exe"
_ELF_MAGIC = b"\x7fELFfake elf"
_SHEBANG = b"#!/bin/bash\nrm -rf /"


# ─────────────────────────────────────────────────────────────────────────────
# Unit tests — validate_upload() directly (no HTTP, no DB, no S3)
# ─────────────────────────────────────────────────────────────────────────────

class TestValidateUpload:
    def test_accepts_valid_pdf(self):
        validate_upload("invoice.pdf", "application/pdf", _PDF_MAGIC)

    def test_accepts_xlsx_magic(self):
        validate_upload(
            "sheet.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            _XLSX_MAGIC,
        )

    def test_accepts_csv_text(self):
        validate_upload("data.csv", "text/csv", _CSV_CONTENT)

    def test_accepts_xml(self):
        validate_upload("declaration.xml", "text/xml", _XML_CONTENT)

    def test_rejects_disallowed_mime(self):
        with pytest.raises(ValueError, match="not accepted"):
            validate_upload("script.js", "application/javascript", b"console.log(1)")

    def test_rejects_windows_executable(self):
        with pytest.raises(ValueError, match="executable or script"):
            validate_upload("malware.pdf", "application/pdf", _MZ_MAGIC)

    def test_rejects_elf_executable(self):
        with pytest.raises(ValueError, match="executable or script"):
            validate_upload("malware", "application/octet-stream", _ELF_MAGIC)

    def test_rejects_shebang_script(self):
        with pytest.raises(ValueError, match="executable or script"):
            validate_upload("run.sh", "text/plain", _SHEBANG)

    def test_rejects_magic_mismatch_pdf_declared_xlsx_bytes(self):
        # Declared PDF but bytes are XLSX (PK header)
        with pytest.raises(ValueError, match="does not match declared type"):
            validate_upload("invoice.pdf", "application/pdf", _XLSX_MAGIC)

    def test_rejects_oversized_file(self):
        with pytest.raises(ValueError, match="maximum allowed size"):
            validate_upload("big.pdf", "application/pdf", b"x" * (MAX_FILE_SIZE + 1))

    def test_accepts_no_content_type_inferred_from_extension(self):
        # content_type=None but filename says .pdf and bytes are PDF magic
        validate_upload("invoice.pdf", None, _PDF_MAGIC)

    def test_rejects_unknown_extension_with_executable_magic(self):
        with pytest.raises(ValueError, match="executable or script"):
            validate_upload("payload.bin", None, _MZ_MAGIC)


# ─────────────────────────────────────────────────────────────────────────────
# HTTP-level tests — mock S3 + DB engine
# ─────────────────────────────────────────────────────────────────────────────

class _FakeS3:
    def __init__(self):
        self.uploads: list[dict] = []

    def put_object(self, **kwargs):
        self.uploads.append(kwargs)


class _Result:
    def __init__(self, row=None):
        self._row = row or {}

    def mappings(self):
        return self

    def one_or_none(self):
        return self._row or None

    def one(self):
        return self._row

    def fetchone(self):
        return self._row or None


_CASE_ID = str(uuid4())
_DOC_RETURNING = {
    "id": str(uuid4()),
    "case_id": _CASE_ID,
    "filename": "invoice.pdf",
    "storage_uri": "s3://bucket/key",
    "sha256": "aabbcc",
    "doc_type": "invoice",
    "uploaded_at": "2025-01-01T00:00:00Z",
}


class _FakeConn:
    """Minimal fake connection for the documents router tests."""

    def execute(self, statement, params=None):
        sql = str(statement)
        if "FROM cases" in sql:
            # _verify_case_access: case exists, no owner_sub (test mode allows)
            return _Result({"owner_sub": None, "tenant_id": None})
        if "INSERT INTO documents" in sql:
            return _Result(_DOC_RETURNING)
        if "INSERT INTO audit_log" in sql:
            return _Result({})
        if "FROM case_acl" in sql:
            return _Result(None)
        raise AssertionError(f"Unexpected SQL in test: {sql!r}")

    def fetchone(self):
        return None


class _FakeTx:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self.conn

    def __exit__(self, *_):
        return False


class _FakeEngine:
    def begin(self):
        return _FakeTx(_FakeConn())


def _make_client(monkeypatch) -> tuple[TestClient, _FakeS3]:
    fake_s3 = _FakeS3()
    monkeypatch.setattr(doc_module, "engine", _FakeEngine())
    monkeypatch.setattr(doc_module, "get_s3_client", lambda: fake_s3)
    monkeypatch.setattr(doc_module, "S3_BUCKET", "test-bucket")
    # Disable HMAC signing dependency
    monkeypatch.setattr(doc_module, "sign_event", lambda *a, **kw: "fake-sig")
    # Reset the rate limiter's in-memory counters so prior tests don't interfere
    doc_module._limiter._storage.reset()

    app = FastAPI()
    app.include_router(doc_module.router)
    return TestClient(app, raise_server_exceptions=False), fake_s3


class TestSingleUploadHTTP:
    def test_valid_pdf_returns_200(self, monkeypatch):
        client, fake_s3 = _make_client(monkeypatch)
        resp = client.post(
            f"/cases/{_CASE_ID}/documents/upload",
            files={"file": ("invoice.pdf", BytesIO(_PDF_MAGIC), "application/pdf")},
            data={"doc_type": "invoice"},
        )
        assert resp.status_code == 200
        assert len(fake_s3.uploads) == 1

    def test_invalid_mime_returns_400_without_s3_call(self, monkeypatch):
        client, fake_s3 = _make_client(monkeypatch)
        resp = client.post(
            f"/cases/{_CASE_ID}/documents/upload",
            files={
                "file": ("payload.js", BytesIO(b"console.log(1)"), "application/javascript")
            },
        )
        assert resp.status_code == 400
        assert "not accepted" in resp.json()["detail"]
        assert len(fake_s3.uploads) == 0  # S3 never called

    def test_executable_magic_returns_400_without_s3_call(self, monkeypatch):
        client, fake_s3 = _make_client(monkeypatch)
        resp = client.post(
            f"/cases/{_CASE_ID}/documents/upload",
            files={"file": ("malware.pdf", BytesIO(_MZ_MAGIC), "application/pdf")},
        )
        assert resp.status_code == 400
        assert "executable or script" in resp.json()["detail"]
        assert len(fake_s3.uploads) == 0

    def test_empty_file_returns_400(self, monkeypatch):
        client, fake_s3 = _make_client(monkeypatch)
        resp = client.post(
            f"/cases/{_CASE_ID}/documents/upload",
            files={"file": ("empty.pdf", BytesIO(b""), "application/pdf")},
        )
        assert resp.status_code == 400


class TestBatchUploadHTTP:
    def test_all_success_returns_201(self, monkeypatch):
        client, fake_s3 = _make_client(monkeypatch)
        resp = client.post(
            f"/cases/{_CASE_ID}/documents/upload/batch",
            files=[
                ("files", ("a.pdf", BytesIO(_PDF_MAGIC), "application/pdf")),
                ("files", ("b.pdf", BytesIO(_PDF_MAGIC), "application/pdf")),
            ],
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["succeeded"] == 2
        assert body["failed"] == 0
        assert all(r["status"] == "ok" for r in body["results"])
        assert len(fake_s3.uploads) == 2

    def test_partial_failure_returns_207(self, monkeypatch):
        client, fake_s3 = _make_client(monkeypatch)
        resp = client.post(
            f"/cases/{_CASE_ID}/documents/upload/batch",
            files=[
                ("files", ("good.pdf", BytesIO(_PDF_MAGIC), "application/pdf")),
                ("files", ("bad.js", BytesIO(b"alert(1)"), "application/javascript")),
            ],
        )
        assert resp.status_code == 207
        body = resp.json()
        assert body["succeeded"] == 1
        assert body["failed"] == 1
        statuses = {r["filename"]: r["status"] for r in body["results"]}
        assert statuses["good.pdf"] == "ok"
        assert statuses["bad.js"] == "error"
        assert len(fake_s3.uploads) == 1  # only the good file reached S3

    def test_exceeds_max_files_returns_400(self, monkeypatch):
        client, fake_s3 = _make_client(monkeypatch)
        many_files = [
            ("files", (f"f{i}.pdf", BytesIO(_PDF_MAGIC), "application/pdf"))
            for i in range(MAX_BATCH_FILES + 1)
        ]
        resp = client.post(
            f"/cases/{_CASE_ID}/documents/upload/batch",
            files=many_files,
        )
        assert resp.status_code == 400
        assert "Maximum" in resp.json()["detail"]
        assert len(fake_s3.uploads) == 0
