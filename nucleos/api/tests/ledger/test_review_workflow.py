"""
The review flag the narrative gate sets on a CBAM case.

flag_for_review and clear_review_flag are called in-process by the narrative
service. They were also HTTP endpoints, beside reviewer approve/reject routes
and a bundle gate, until those were removed with the pre-integration pipeline
(docs/audits/2026-09-27-nucleos-endpoints.md). The state machine they enforce is
unchanged, and is what these tests pin:

    null -> pending_review            (flag)
    rejected -> pending_review        (flag, after a re-run fails)
    pending_review/rejected -> null   (clear, after a re-run passes)
    approved                          (terminal; flag and clear are no-ops)

All tests use a fake engine / fake connection — no real DB required.
"""
from __future__ import annotations

import os
from uuid import uuid4

import pytest
from fastapi import HTTPException

os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")

import ledger_app.api.review as review_module
from shared_auth.models import AuthContext

CASE_ID = str(uuid4())

_SERVICE = AuthContext(
    sub="narrative-service",
    tenant_id="test-tenant",
    scopes=["cbam:write"],
    jti="internal",
    exp=9_999_999_999,
)


class _FakeResult:
    def __init__(self, row=None):
        self._row = row

    def fetchone(self):
        return self._row


class _FakeConn:
    def __init__(self, review_status: str | None = None):
        self.review_status = review_status

    def execute(self, statement, params=None):
        params = params or {}
        sql = str(statement)
        if "FROM cbam.cbam_cases" in sql:
            if params.get("id") == CASE_ID:
                return _FakeResult(row=(self.review_status,))
            return _FakeResult(row=None)
        if "UPDATE cbam.cbam_cases" in sql:
            if "review_status = 'pending_review'" in sql:
                self.review_status = "pending_review"
            elif "review_status = NULL" in sql:
                self.review_status = None
            return _FakeResult()
        raise AssertionError(f"Unexpected SQL in test: {sql!r}")


class _FakeTx:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self.conn

    def __exit__(self, *_):
        return False


class _FakeEngine:
    def __init__(self, conn):
        self._conn = conn

    def begin(self):
        return _FakeTx(self._conn)


@pytest.fixture
def case(monkeypatch):
    """A fake case whose review_status each test sets."""
    conn = _FakeConn()
    monkeypatch.setattr(review_module, "_cbam_engine", _FakeEngine(conn))
    monkeypatch.setattr(review_module, "_write_audit_event", lambda *a, **kw: None)
    return conn


class TestFlag:

    def test_flag_sets_pending_review(self, case):
        review_module.flag_for_review(CASE_ID, auth_context=_SERVICE)
        assert case.review_status == "pending_review"

    def test_flag_is_idempotent_already_pending(self, case):
        case.review_status = "pending_review"
        review_module.flag_for_review(CASE_ID, auth_context=_SERVICE)
        assert case.review_status == "pending_review"

    def test_flag_is_noop_when_approved(self, case):
        case.review_status = "approved"
        review_module.flag_for_review(CASE_ID, auth_context=_SERVICE)
        assert case.review_status == "approved"

    def test_flag_from_rejected_sets_pending(self, case):
        case.review_status = "rejected"
        review_module.flag_for_review(CASE_ID, auth_context=_SERVICE)
        assert case.review_status == "pending_review"

    def test_flag_missing_case_raises_404(self, case):
        with pytest.raises(HTTPException) as exc:
            review_module.flag_for_review(str(uuid4()), auth_context=_SERVICE)
        assert exc.value.status_code == 404


class TestClear:

    def test_clear_pending_review_sets_null(self, case):
        case.review_status = "pending_review"
        review_module.clear_review_flag(CASE_ID, auth_context=_SERVICE)
        assert case.review_status is None

    def test_clear_rejected_sets_null(self, case):
        case.review_status = "rejected"
        review_module.clear_review_flag(CASE_ID, auth_context=_SERVICE)
        assert case.review_status is None

    def test_clear_approved_is_noop(self, case):
        case.review_status = "approved"
        review_module.clear_review_flag(CASE_ID, auth_context=_SERVICE)
        assert case.review_status == "approved"

    def test_clear_null_is_noop(self, case):
        review_module.clear_review_flag(CASE_ID, auth_context=_SERVICE)
        assert case.review_status is None


class TestReRunPath:

    def test_a_failed_re_run_flags_again_and_a_passing_one_clears(self, case):
        review_module.flag_for_review(CASE_ID, auth_context=_SERVICE)
        assert case.review_status == "pending_review"
        review_module.clear_review_flag(CASE_ID, auth_context=_SERVICE)
        assert case.review_status is None
        review_module.flag_for_review(CASE_ID, auth_context=_SERVICE)
        assert case.review_status == "pending_review"

    def test_approved_is_terminal(self, case):
        case.review_status = "approved"
        review_module.flag_for_review(CASE_ID, auth_context=_SERVICE)
        review_module.clear_review_flag(CASE_ID, auth_context=_SERVICE)
        assert case.review_status == "approved"
