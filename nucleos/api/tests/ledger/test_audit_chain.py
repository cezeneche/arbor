"""Tests for the audit log hash chain — sign_event, verify_event, verify_chain.

All tests are pure unit tests that work on row dicts directly (no DB required).
The chain uses HMAC-SHA256 where each row's signature covers the preceding row's
HMAC, making deletion or reordering detectable.

Coverage:
- sign_event: determinism, prev_hmac changes the signature, None == "" for chain
- verify_event: chained format, legacy format (no prev_hmac), unsigned, tampered
- verify_chain: valid chain, gap (row deleted), reorder, tamper, mixed unsigned rows
- verify_chain: single row, empty list, all-unsigned (no signed rows)
- get_prev_chain_hmac: no prior rows, prior unsigned row, prior signed row
- Backward compat: legacy rows signed without chain link still verify True
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from unittest.mock import MagicMock

import pytest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

KEY = "test-audit-signing-key-distinct-from-jwt!"


@pytest.fixture(autouse=True)
def _set_signing_key(monkeypatch):
    monkeypatch.setenv("AUDIT_SIGNING_KEY", KEY)


def _sign_legacy(case_id, event_type, actor_sub, event_json_str) -> str:
    """Sign using the OLD format (no chain link) to produce legacy test rows."""
    msg = f"{case_id}|{event_type}|{actor_sub}|{event_json_str}".encode("utf-8")
    return hmac.new(KEY.encode(), msg, hashlib.sha256).hexdigest()


def _make_row(
    case_id: str = "case-1",
    event_type: str = "case_created",
    actor_sub: str = "user-1",
    event_json: dict | None = None,
    prev_hmac: str | None = None,
    hmac_sha256: str | None = None,  # if None, computed automatically
    signed: bool = True,
    legacy: bool = False,
) -> dict:
    """Build a test audit_log row dict."""
    import uuid
    if event_json is None:
        event_json = {"note": "test event"}
    event_json_str = json.dumps(event_json, sort_keys=True)

    if signed:
        if legacy:
            sig = _sign_legacy(case_id, event_type, actor_sub, event_json_str)
        else:
            from ledger_app.services.audit_signer import sign_event
            sig = sign_event(case_id, event_type, actor_sub, event_json_str,
                             prev_hmac=prev_hmac)
    else:
        sig = None

    return {
        "id": str(uuid.uuid4()),
        "case_id": case_id,
        "event_type": event_type,
        "actor_sub": actor_sub,
        "event_json": event_json,
        "hmac_sha256": hmac_sha256 if hmac_sha256 is not None else sig,
        "prev_hmac": prev_hmac,
    }


def _chain_rows(case_id: str, count: int) -> list[dict]:
    """Build a valid N-row chain."""
    rows = []
    prev = None
    for i in range(count):
        row = _make_row(
            case_id=case_id,
            event_type=f"event_{i}",
            event_json={"seq": i},
            prev_hmac=prev,
        )
        prev = row["hmac_sha256"]
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# TestSignEvent
# ---------------------------------------------------------------------------

class TestSignEvent:

    def test_deterministic_same_inputs(self):
        from ledger_app.services.audit_signer import sign_event
        s1 = sign_event("c1", "evt", "u1", '{"x":1}', prev_hmac="abc")
        s2 = sign_event("c1", "evt", "u1", '{"x":1}', prev_hmac="abc")
        assert s1 == s2

    def test_different_prev_hmac_different_signature(self):
        from ledger_app.services.audit_signer import sign_event
        s1 = sign_event("c1", "evt", "u1", '{"x":1}', prev_hmac="aaa")
        s2 = sign_event("c1", "evt", "u1", '{"x":1}', prev_hmac="bbb")
        assert s1 != s2

    def test_none_and_empty_string_prev_hmac_equivalent(self):
        from ledger_app.services.audit_signer import sign_event
        s1 = sign_event("c1", "evt", "u1", '{"x":1}', prev_hmac=None)
        s2 = sign_event("c1", "evt", "u1", '{"x":1}', prev_hmac="")
        assert s1 == s2

    def test_new_format_differs_from_legacy(self):
        """New format (with |chain_link suffix) must differ from legacy format."""
        from ledger_app.services.audit_signer import sign_event
        new_sig = sign_event("c1", "evt", "u1", '{"x":1}', prev_hmac=None)
        legacy_sig = _sign_legacy("c1", "evt", "u1", '{"x":1}')
        assert new_sig != legacy_sig

    def test_returns_hex_string(self):
        from ledger_app.services.audit_signer import sign_event
        sig = sign_event("c1", "evt", "u1", '{}')
        assert len(sig) == 64
        assert all(c in "0123456789abcdef" for c in sig)


# ---------------------------------------------------------------------------
# TestVerifyEvent
# ---------------------------------------------------------------------------

class TestVerifyEvent:

    def test_chained_row_verifies(self):
        from ledger_app.services.audit_signer import verify_event
        row = _make_row(prev_hmac="deadbeef")
        assert verify_event(row) is True

    def test_first_in_chain_no_prev_hmac_verifies(self):
        from ledger_app.services.audit_signer import verify_event
        row = _make_row(prev_hmac=None)
        assert verify_event(row) is True

    def test_legacy_row_verifies(self):
        """Row signed with old format (no chain suffix) must still verify True."""
        from ledger_app.services.audit_signer import verify_event
        row = _make_row(legacy=True)
        # Legacy rows have prev_hmac=None in the DB (not set by old code)
        assert verify_event(row) is True

    def test_unsigned_row_returns_none(self):
        from ledger_app.services.audit_signer import verify_event
        row = _make_row(signed=False)
        assert verify_event(row) is None

    def test_tampered_event_json_returns_false(self):
        from ledger_app.services.audit_signer import verify_event
        row = _make_row(prev_hmac=None)
        row["event_json"] = {"tampered": True}  # change payload without re-signing
        assert verify_event(row) is False

    def test_wrong_prev_hmac_returns_false(self):
        """Row stored with prev_hmac=X but we change it to Y → mismatch."""
        from ledger_app.services.audit_signer import verify_event
        row = _make_row(prev_hmac="correct_prev")
        row["prev_hmac"] = "wrong_prev"  # mutate stored prev_hmac
        assert verify_event(row) is False

    def test_wrong_actor_sub_returns_false(self):
        from ledger_app.services.audit_signer import verify_event
        row = _make_row(actor_sub="user-1")
        row["actor_sub"] = "attacker"
        assert verify_event(row) is False

    def test_missing_hmac_sha256_returns_none(self):
        from ledger_app.services.audit_signer import verify_event
        row = _make_row(signed=False)
        assert row.get("hmac_sha256") is None
        assert verify_event(row) is None


# ---------------------------------------------------------------------------
# TestVerifyChain
# ---------------------------------------------------------------------------

class TestVerifyChain:

    def test_empty_rows_is_valid(self):
        from ledger_app.services.audit_signer import verify_chain
        result = verify_chain([])
        assert result.chain_valid is True
        assert result.signed_count == 0
        assert result.chained_count == 0

    def test_single_unchained_row_is_valid(self):
        from ledger_app.services.audit_signer import verify_chain
        rows = [_make_row(prev_hmac=None)]
        result = verify_chain(rows)
        assert result.chain_valid is True
        assert result.signed_count == 1
        assert result.chained_count == 0

    def test_valid_three_row_chain(self):
        from ledger_app.services.audit_signer import verify_chain
        rows = _chain_rows("case-x", 3)
        result = verify_chain(rows)
        assert result.chain_valid is True
        assert result.signed_count == 3
        assert result.chained_count == 2  # rows 1 and 2 have prev_hmac
        assert result.broken_at_index is None
        assert result.issues == []

    def test_gap_middle_row_deleted(self):
        """Delete row[1] from a 3-row chain: row[2].prev_hmac no longer matches row[0]."""
        from ledger_app.services.audit_signer import verify_chain
        rows = _chain_rows("case-x", 3)
        rows_with_gap = [rows[0], rows[2]]  # rows[1] deleted
        result = verify_chain(rows_with_gap)
        assert result.chain_valid is False
        assert result.broken_at_index == 1  # index in the truncated list

    def test_reordered_rows_detected(self):
        """Swap rows[0] and rows[1] — rows[1].prev_hmac points to nothing."""
        from ledger_app.services.audit_signer import verify_chain
        rows = _chain_rows("case-x", 3)
        reordered = [rows[1], rows[0], rows[2]]
        result = verify_chain(reordered)
        assert result.chain_valid is False

    def test_tampered_row_in_middle_detected(self):
        """Tamper with rows[1].event_json → its HMAC fails."""
        from ledger_app.services.audit_signer import verify_chain
        rows = _chain_rows("case-x", 3)
        rows[1]["event_json"] = {"tampered": True}
        result = verify_chain(rows)
        assert result.chain_valid is False
        assert result.broken_at_index == 1

    def test_unsigned_rows_skipped_chain_still_valid(self):
        """Unsigned rows interspersed between signed rows — chain remains valid."""
        from ledger_app.services.audit_signer import verify_chain
        rows = _chain_rows("case-x", 2)
        unsigned = _make_row(signed=False)
        mixed = [rows[0], unsigned, rows[1]]
        result = verify_chain(mixed)
        assert result.chain_valid is True
        assert result.signed_count == 2

    def test_legacy_rows_verify_without_breaking_chain(self):
        """Legacy rows (signed without chain suffix) verify via Pass 2 — chain not broken."""
        from ledger_app.services.audit_signer import verify_chain
        legacy = _make_row(legacy=True, prev_hmac=None)
        result = verify_chain([legacy])
        assert result.chain_valid is True
        assert result.signed_count == 1
        assert result.chained_count == 0

    def test_prev_hmac_points_to_unknown_predecessor(self):
        """A chained row with no prior signed row in sequence → chain broken."""
        from ledger_app.services.audit_signer import verify_chain
        # Build a row that claims a prev_hmac but there's no prior signed row
        from ledger_app.services.audit_signer import sign_event
        event_json_str = json.dumps({"note": "test"}, sort_keys=True)
        phantom_prev = "a" * 64  # some HMAC that was never in this sequence
        sig = sign_event("c1", "evt", "u1", event_json_str, prev_hmac=phantom_prev)
        row = {
            "id": "row-1",
            "case_id": "c1",
            "event_type": "evt",
            "actor_sub": "u1",
            "event_json": {"note": "test"},
            "hmac_sha256": sig,
            "prev_hmac": phantom_prev,
        }
        result = verify_chain([row])
        assert result.chain_valid is False
        assert result.broken_at_index == 0

    def test_all_unsigned_rows_chain_valid(self):
        """No signed rows → nothing to chain → chain_valid=True."""
        from ledger_app.services.audit_signer import verify_chain
        rows = [_make_row(signed=False) for _ in range(3)]
        result = verify_chain(rows)
        assert result.chain_valid is True
        assert result.signed_count == 0


# ---------------------------------------------------------------------------
# TestGetPrevChainHmac
# ---------------------------------------------------------------------------

class TestGetPrevChainHmac:

    def _mock_conn(self, hmac_value: str | None) -> MagicMock:
        """Return a mock SQLAlchemy connection whose fetchone() yields hmac_value."""
        conn = MagicMock()
        row = (hmac_value,) if hmac_value is not None else None
        conn.execute.return_value.fetchone.return_value = row
        return conn

    def test_no_prior_rows_returns_none(self):
        from ledger_app.services.audit_signer import get_prev_chain_hmac
        conn = self._mock_conn(None)
        assert get_prev_chain_hmac("case-1", conn) is None

    def test_prior_signed_row_returns_its_hmac(self):
        from ledger_app.services.audit_signer import get_prev_chain_hmac
        expected = "a" * 64
        conn = self._mock_conn(expected)
        assert get_prev_chain_hmac("case-1", conn) == expected


# ---------------------------------------------------------------------------
# TestChainRoundTrip — sign then verify
# ---------------------------------------------------------------------------

class TestChainRoundTrip:

    def test_five_row_chain_end_to_end(self):
        """Build a 5-row chain and verify it is fully intact."""
        from ledger_app.services.audit_signer import verify_chain
        rows = _chain_rows("case-e2e", 5)
        result = verify_chain(rows)
        assert result.chain_valid is True
        assert result.signed_count == 5
        assert result.chained_count == 4

    def test_inject_fake_row_in_middle_detected(self):
        """Insert a correctly-signed fake row that claims to chain from row[0].
        This breaks the chain because rows[1].prev_hmac now points to the fake row,
        not row[0].
        """
        from ledger_app.services.audit_signer import sign_event, verify_chain
        rows = _chain_rows("case-e2e", 3)
        # Build a fake row that correctly chains from rows[0]
        fake_event = '{"fake": true}'
        fake_prev = rows[0]["hmac_sha256"]
        fake_sig = sign_event("case-e2e", "fake_event", "attacker", fake_event,
                              prev_hmac=fake_prev)
        fake_row = {
            "id": "fake",
            "case_id": "case-e2e",
            "event_type": "fake_event",
            "actor_sub": "attacker",
            "event_json": {"fake": True},
            "hmac_sha256": fake_sig,
            "prev_hmac": fake_prev,
        }
        # Insert fake row between rows[0] and rows[1]
        injected = [rows[0], fake_row, rows[1], rows[2]]
        result = verify_chain(injected)
        # rows[1].prev_hmac still points to rows[0], not fake_row → chain broken
        assert result.chain_valid is False
