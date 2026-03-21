"""
Tests for the human review workflow.

Covers all 5 endpoints:
    POST /cases/{case_id}/review/flag     — sets pending_review (cbam:write)
    POST /cases/{case_id}/review/clear    — clears pending_review/rejected (cbam:write)
    POST /cases/{case_id}/review/approve  — approve; sets signed_off (review:write)
    POST /cases/{case_id}/review/reject   — reject; sets rejected (review:write)
    GET  /cases/{case_id}/review          — status + history (cbam:read)

And the bundle gate: GET /cases/{case_id}/bundle → 409 when pending_review.

All tests use a fake engine / fake connection — no real DB required.
"""
from __future__ import annotations

import json
import os
from typing import Any
from uuid import uuid4

import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")

import ledger_app.api.review as review_module
import ledger_app.api.bundle as bundle_module
from shared_auth import get_auth_context
from shared_auth.testing import make_test_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

CASE_ID = str(uuid4())
SIGNOFF_ID = str(uuid4())


def _auth(scopes: list[str]) -> dict[str, str]:
    token = make_test_token(sub="test-user", tenant_id="test-tenant", scopes=scopes)
    return {"Authorization": f"Bearer {token}"}


_WRITE = _auth(["cbam:write"])
_READ = _auth(["cbam:read"])
_REVIEW = _auth(["cbam:write", "review:write"])
_CBAM_ONLY = _auth(["cbam:write"])  # lacks review:write


# ---------------------------------------------------------------------------
# Fake DB layer
# ---------------------------------------------------------------------------

class _FakeConnBase:
    """
    Base fake connection. Subclasses set `review_status` and override as needed.
    """

    review_status: str | None = None
    case_status: str = "narrative_drafted"

    def execute(self, statement, params=None):
        params = params or {}
        sql = str(statement)
        return self._dispatch(sql, params)

    def _dispatch(self, sql: str, params: dict) -> "_FakeResult":
        # --- cbam_cases SELECT ---
        if "FROM cbam.cbam_cases" in sql:
            if params.get("id") == CASE_ID or params.get("case_id") == CASE_ID:
                if "review_status, status" in sql:
                    return _FakeResult(row=(self.review_status, self.case_status))
                return _FakeResult(row=(self.review_status,))
            return _FakeResult(row=None)

        # --- cbam_cases UPDATE ---
        if "UPDATE cbam.cbam_cases" in sql:
            if "review_status = 'pending_review'" in sql:
                self.review_status = "pending_review"
            elif "review_status = 'approved'" in sql:
                self.review_status = "approved"
                self.case_status = "signed_off"
            elif "review_status = 'rejected'" in sql:
                self.review_status = "rejected"
            elif "review_status = NULL" in sql:
                self.review_status = None
            return _FakeResult()

        # --- cbam.audit_log SELECT (signoff history) ---
        if "FROM cbam.audit_log" in sql:
            return _FakeResult(rows=[])

        raise AssertionError(f"Unexpected SQL in test: {sql!r}")

    def fetchone(self):
        return None


class _FakeResult:
    def __init__(self, row=None, rows=None, mapping=None):
        self._row = row
        self._rows = rows or []
        self._mapping = mapping

    def fetchone(self):
        return self._row

    def mappings(self):
        return self

    def one(self):
        if self._mapping is not None:
            return self._mapping
        raise AssertionError("No mapping set")

    def all(self):
        return self._rows


class _FakeTx:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self.conn

    def __exit__(self, *_):
        return False


class _FakeConnCtx:
    """connect() context manager (for read-only endpoints)."""
    def __init__(self, conn):
        self._conn = conn

    def __enter__(self):
        return self._conn

    def __exit__(self, *_):
        return False


class _FakeEngine:
    def __init__(self, conn):
        self._conn = conn

    def begin(self):
        return _FakeTx(self._conn)

    def connect(self):
        return _FakeConnCtx(self._conn)


def _make_review_client(conn: _FakeConnBase) -> TestClient:
    """Build a TestClient with the review router and auth dependency."""
    monkeypatched_engine = _FakeEngine(conn)
    review_module._cbam_engine = monkeypatched_engine
    # Patch _write_audit_event so no real DB / HMAC key is needed
    review_module._write_audit_event = lambda *a, **kw: None

    app = FastAPI()
    app.include_router(
        review_module.router,
        prefix="/api",
        dependencies=[Depends(get_auth_context)],
    )
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# TestFlagEndpoint
# ---------------------------------------------------------------------------

class TestFlagEndpoint:

    def test_flag_sets_pending_review(self):
        conn = _FakeConnBase()
        client = _make_review_client(conn)
        resp = client.post(f"/api/cases/{CASE_ID}/review/flag", headers=_WRITE)
        assert resp.status_code == 204
        assert conn.review_status == "pending_review"

    def test_flag_is_idempotent_already_pending(self):
        conn = _FakeConnBase()
        conn.review_status = "pending_review"
        client = _make_review_client(conn)
        resp = client.post(f"/api/cases/{CASE_ID}/review/flag", headers=_WRITE)
        assert resp.status_code == 204
        assert conn.review_status == "pending_review"  # unchanged

    def test_flag_is_noop_when_approved(self):
        conn = _FakeConnBase()
        conn.review_status = "approved"
        client = _make_review_client(conn)
        resp = client.post(f"/api/cases/{CASE_ID}/review/flag", headers=_WRITE)
        assert resp.status_code == 204
        assert conn.review_status == "approved"  # approved is terminal

    def test_flag_from_rejected_sets_pending(self):
        conn = _FakeConnBase()
        conn.review_status = "rejected"
        client = _make_review_client(conn)
        resp = client.post(f"/api/cases/{CASE_ID}/review/flag", headers=_WRITE)
        assert resp.status_code == 204
        assert conn.review_status == "pending_review"

    def test_flag_missing_case_returns_404(self):
        conn = _FakeConnBase()
        client = _make_review_client(conn)
        resp = client.post(f"/api/cases/{uuid4()}/review/flag", headers=_WRITE)
        assert resp.status_code == 404

    def test_flag_requires_cbam_write_scope(self):
        conn = _FakeConnBase()
        client = _make_review_client(conn)
        resp = client.post(f"/api/cases/{CASE_ID}/review/flag", headers=_READ)
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# TestClearEndpoint
# ---------------------------------------------------------------------------

class TestClearEndpoint:

    def test_clear_pending_review_sets_null(self):
        conn = _FakeConnBase()
        conn.review_status = "pending_review"
        client = _make_review_client(conn)
        resp = client.post(f"/api/cases/{CASE_ID}/review/clear", headers=_WRITE)
        assert resp.status_code == 204
        assert conn.review_status is None

    def test_clear_rejected_sets_null(self):
        conn = _FakeConnBase()
        conn.review_status = "rejected"
        client = _make_review_client(conn)
        resp = client.post(f"/api/cases/{CASE_ID}/review/clear", headers=_WRITE)
        assert resp.status_code == 204
        assert conn.review_status is None

    def test_clear_approved_is_noop(self):
        conn = _FakeConnBase()
        conn.review_status = "approved"
        client = _make_review_client(conn)
        resp = client.post(f"/api/cases/{CASE_ID}/review/clear", headers=_WRITE)
        assert resp.status_code == 204
        assert conn.review_status == "approved"  # terminal — unchanged

    def test_clear_null_is_noop(self):
        conn = _FakeConnBase()
        conn.review_status = None
        client = _make_review_client(conn)
        resp = client.post(f"/api/cases/{CASE_ID}/review/clear", headers=_WRITE)
        assert resp.status_code == 204
        assert conn.review_status is None


# ---------------------------------------------------------------------------
# TestApproveEndpoint
# ---------------------------------------------------------------------------

class TestApproveEndpoint:

    _body = {"reviewer_name": "Jane Smith", "reviewer_email": "j@eu.int", "comments": "LGTM"}

    def test_approve_pending_review_returns_200_and_signed_off(self):
        conn = _FakeConnBase()
        conn.review_status = "pending_review"
        client = _make_review_client(conn)
        resp = client.post(
            f"/api/cases/{CASE_ID}/review/approve",
            json=self._body,
            headers=_REVIEW,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["decision"] == "approved"
        assert data["case_id"] == CASE_ID
        assert conn.review_status == "approved"
        assert conn.case_status == "signed_off"

    def test_approve_non_pending_returns_409(self):
        for status in (None, "rejected", "approved"):
            conn = _FakeConnBase()
            conn.review_status = status
            client = _make_review_client(conn)
            resp = client.post(
                f"/api/cases/{CASE_ID}/review/approve",
                json=self._body,
                headers=_REVIEW,
            )
            assert resp.status_code == 409, f"Expected 409 for review_status={status!r}"

    def test_approve_missing_case_returns_404(self):
        conn = _FakeConnBase()
        client = _make_review_client(conn)
        resp = client.post(
            f"/api/cases/{uuid4()}/review/approve",
            json=self._body,
            headers=_REVIEW,
        )
        assert resp.status_code == 404

    def test_approve_requires_review_write_scope(self):
        conn = _FakeConnBase()
        conn.review_status = "pending_review"
        client = _make_review_client(conn)
        # cbam:write only — missing review:write
        resp = client.post(
            f"/api/cases/{CASE_ID}/review/approve",
            json=self._body,
            headers=_CBAM_ONLY,
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# TestRejectEndpoint
# ---------------------------------------------------------------------------

class TestRejectEndpoint:

    _body = {"reviewer_name": "Jane Smith", "comments": "Fix operator data for installation X"}

    def test_reject_pending_review_returns_200(self):
        conn = _FakeConnBase()
        conn.review_status = "pending_review"
        client = _make_review_client(conn)
        resp = client.post(
            f"/api/cases/{CASE_ID}/review/reject",
            json=self._body,
            headers=_REVIEW,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["decision"] == "rejected"
        assert conn.review_status == "rejected"

    def test_reject_non_pending_returns_409(self):
        for status in (None, "rejected", "approved"):
            conn = _FakeConnBase()
            conn.review_status = status
            client = _make_review_client(conn)
            resp = client.post(
                f"/api/cases/{CASE_ID}/review/reject",
                json=self._body,
                headers=_REVIEW,
            )
            assert resp.status_code == 409

    def test_reject_requires_review_write_scope(self):
        conn = _FakeConnBase()
        conn.review_status = "pending_review"
        client = _make_review_client(conn)
        resp = client.post(
            f"/api/cases/{CASE_ID}/review/reject",
            json=self._body,
            headers=_CBAM_ONLY,
        )
        assert resp.status_code == 403

    def test_reject_body_without_email_is_accepted(self):
        conn = _FakeConnBase()
        conn.review_status = "pending_review"
        client = _make_review_client(conn)
        resp = client.post(
            f"/api/cases/{CASE_ID}/review/reject",
            json={"reviewer_name": "Bob"},
            headers=_REVIEW,
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# TestGetReview
# ---------------------------------------------------------------------------

class TestGetReview:

    def test_returns_null_review_status_and_empty_signoffs(self):
        conn = _FakeConnBase()
        conn.review_status = None
        client = _make_review_client(conn)
        resp = client.get(f"/api/cases/{CASE_ID}/review", headers=_READ)
        assert resp.status_code == 200
        data = resp.json()
        assert data["review_status"] is None
        assert data["signoffs"] == []

    def test_returns_pending_review_status(self):
        conn = _FakeConnBase()
        conn.review_status = "pending_review"
        client = _make_review_client(conn)
        resp = client.get(f"/api/cases/{CASE_ID}/review", headers=_READ)
        assert resp.status_code == 200
        assert resp.json()["review_status"] == "pending_review"

    def test_missing_case_returns_404(self):
        conn = _FakeConnBase()
        client = _make_review_client(conn)
        resp = client.get(f"/api/cases/{uuid4()}/review", headers=_READ)
        assert resp.status_code == 404

    def test_requires_cbam_read_scope(self):
        conn = _FakeConnBase()
        client = _make_review_client(conn)
        no_scope_token = make_test_token(sub="x", tenant_id="t", scopes=[])
        resp = client.get(
            f"/api/cases/{CASE_ID}/review",
            headers={"Authorization": f"Bearer {no_scope_token}"},
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# TestBundleGate
# ---------------------------------------------------------------------------

class _BundleFakeConn(_FakeConnBase):
    """Fake connection for bundle endpoint tests."""

    def _dispatch(self, sql: str, params: dict) -> "_FakeResult":
        # bundle selects the case with review_status
        if "FROM cases" in sql and "WHERE id = :case_id" in sql:
            if params.get("case_id") == CASE_ID:
                return _FakeResult(row={
                    "id": CASE_ID,
                    "supplier_name": "Test Supplier",
                    "supplier_country": "DE",
                    "reporting_period_start": "2024-01-01",
                    "reporting_period_end": "2024-12-31",
                    "external_ref": None,
                    "status": self.case_status,
                    "review_status": self.review_status,
                    "created_at": "2024-01-01T00:00:00Z",
                })
            return _FakeResult(row=None)

        # documents, extractions, calculations, audit queries
        if "FROM documents" in sql:
            return _FakeResult(rows=[])
        if "FROM extractions" in sql:
            return _FakeResult(row=None)
        if "FROM calculations" in sql:
            return _FakeResult(row=None)
        if "FROM audit_log" in sql:
            return _FakeResult(rows=[])

        return super()._dispatch(sql, params)

    def mappings(self):
        return self

    def fetchone(self):
        return None

    def all(self):
        return []


class _BundleFakeResult(_FakeResult):
    def mappings(self):
        return self

    def fetchone(self):
        return self._row

    def all(self):
        return self._rows


def _make_bundle_client(conn: _BundleFakeConn) -> TestClient:
    bundle_module.engine = _FakeEngine(conn)
    app = FastAPI()
    app.include_router(
        bundle_module.router,
        prefix="/api",
        dependencies=[Depends(get_auth_context)],
    )
    return TestClient(app, raise_server_exceptions=False)


class TestBundleGate:

    def test_bundle_200_when_review_status_null(self):
        conn = _BundleFakeConn()
        conn.review_status = None
        client = _make_bundle_client(conn)
        resp = client.get(f"/api/cases/{CASE_ID}/bundle", headers=_READ)
        assert resp.status_code == 200

    def test_bundle_200_when_review_status_approved(self):
        conn = _BundleFakeConn()
        conn.review_status = "approved"
        conn.case_status = "signed_off"
        client = _make_bundle_client(conn)
        resp = client.get(f"/api/cases/{CASE_ID}/bundle", headers=_READ)
        assert resp.status_code == 200

    def test_bundle_409_when_review_status_pending_review(self):
        conn = _BundleFakeConn()
        conn.review_status = "pending_review"
        client = _make_bundle_client(conn)
        resp = client.get(f"/api/cases/{CASE_ID}/bundle", headers=_READ)
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert detail["review_status"] == "pending_review"


# ---------------------------------------------------------------------------
# TestReRunPath — state machine end-to-end
# ---------------------------------------------------------------------------

class TestReRunPath:

    def test_flag_reject_clear_returns_to_null(self):
        """flag → reject → clear (pipeline re-runs and passes) → review_status is null."""
        conn = _FakeConnBase()
        client = _make_review_client(conn)

        # 1. flag
        r = client.post(f"/api/cases/{CASE_ID}/review/flag", headers=_WRITE)
        assert r.status_code == 204
        assert conn.review_status == "pending_review"

        # 2. reject
        r = client.post(
            f"/api/cases/{CASE_ID}/review/reject",
            json={"reviewer_name": "Bob", "comments": "Needs correction"},
            headers=_REVIEW,
        )
        assert r.status_code == 200
        assert conn.review_status == "rejected"

        # 3. clear (pipeline re-runs and passes)
        r = client.post(f"/api/cases/{CASE_ID}/review/clear", headers=_WRITE)
        assert r.status_code == 204
        assert conn.review_status is None

    def test_flag_reject_flag_back_to_pending(self):
        """flag → reject → flag (pipeline re-runs and fails again) → pending_review."""
        conn = _FakeConnBase()
        client = _make_review_client(conn)

        # 1. flag
        r = client.post(f"/api/cases/{CASE_ID}/review/flag", headers=_WRITE)
        assert r.status_code == 204

        # 2. reject
        r = client.post(
            f"/api/cases/{CASE_ID}/review/reject",
            json={"reviewer_name": "Bob"},
            headers=_REVIEW,
        )
        assert r.status_code == 200
        assert conn.review_status == "rejected"

        # 3. pipeline fails again — flag from rejected → pending_review
        r = client.post(f"/api/cases/{CASE_ID}/review/flag", headers=_WRITE)
        assert r.status_code == 204
        assert conn.review_status == "pending_review"

    def test_approved_is_terminal_clear_and_flag_are_noop(self):
        """approve → clear/flag are both no-ops — approved stays."""
        conn = _FakeConnBase()
        conn.review_status = "pending_review"
        client = _make_review_client(conn)

        # approve
        r = client.post(
            f"/api/cases/{CASE_ID}/review/approve",
            json={"reviewer_name": "Alice"},
            headers=_REVIEW,
        )
        assert r.status_code == 200
        assert conn.review_status == "approved"

        # clear — no-op
        r = client.post(f"/api/cases/{CASE_ID}/review/clear", headers=_WRITE)
        assert r.status_code == 204
        assert conn.review_status == "approved"

        # flag — no-op
        r = client.post(f"/api/cases/{CASE_ID}/review/flag", headers=_WRITE)
        assert r.status_code == 204
        assert conn.review_status == "approved"
