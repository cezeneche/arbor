"""The audit chain distinguishes a documented gap from tampering (fix F4).

A chain with a hole in it and a chain whose contents were altered are both
"invalid" to a naive verifier, but they mean completely different things to an
auditor: the first is a recorded administrative act, the second is evidence of
interference.  Collapsing them into one verdict makes the chain useless as
evidence, because every real gap looks like an attack.

Gaps arise legitimately — a case soft-deleted under retention policy still has
its audit rows, but a run of rows may be sealed and excluded from a scoped
query.  Tampering does not.
"""
from __future__ import annotations

import json
import os

import pytest

os.environ.setdefault("AUDIT_SIGNING_KEY", "test-audit-signing-key")

from ledger_app.services.audit_signer import (  # noqa: E402
    sign_event,
    verify_chain,
)

pytestmark = pytest.mark.regulatory

CASE = "11111111-1111-1111-1111-111111111111"


def _row(idx: int, event_type: str, prev_hmac: str | None, *, event=None):
    payload = event if event is not None else {"seq": idx}
    event_json_str = json.dumps(payload, sort_keys=True, default=str)
    return {
        "id": f"row-{idx}",
        "case_id": CASE,
        "event_type": event_type,
        "actor_sub": "tester",
        "event_json": payload,
        "prev_hmac": prev_hmac,
        "hmac_sha256": sign_event(
            CASE, event_type, "tester", event_json_str, prev_hmac=prev_hmac
        ),
    }


def _chain(n: int) -> list[dict]:
    rows: list[dict] = []
    prev: str | None = None
    for i in range(n):
        row = _row(i, f"event_{i}", prev)
        rows.append(row)
        prev = row["hmac_sha256"]
    return rows


class TestIntactChain:
    def test_intact_chain_is_valid_with_no_gaps(self):
        result = verify_chain(_chain(4))
        assert result.chain_valid is True
        assert result.tampered is False
        assert result.gaps == []


class TestTampering:
    def test_altered_payload_is_reported_as_tampering(self):
        rows = _chain(4)
        rows[2]["event_json"] = {"seq": 2, "injected": True}

        result = verify_chain(rows)
        assert result.chain_valid is False
        assert result.tampered is True
        assert result.broken_at_index == 2

    def test_reordered_rows_are_reported_as_tampering(self):
        rows = _chain(4)
        rows[1], rows[2] = rows[2], rows[1]

        result = verify_chain(rows)
        assert result.tampered is True


class TestGaps:
    def test_removed_row_is_reported_as_a_gap_not_tampering(self):
        """Every remaining row still verifies on its own; only the link is
        missing. That is a gap in the record, not evidence of alteration."""
        rows = _chain(5)
        del rows[2]

        result = verify_chain(rows)
        assert result.chain_valid is False
        assert result.tampered is False
        assert len(result.gaps) == 1
        assert result.gaps[0]["index"] == 2

    def test_gap_records_the_break_for_the_auditor(self):
        rows = _chain(5)
        del rows[2]

        gap = verify_chain(rows).gaps[0]
        assert gap["expected_prev_hmac"] != gap["found_prev_hmac"]

    def test_documented_gap_is_accepted_when_declared(self):
        """A gap the operator has recorded is not an integrity failure."""
        rows = _chain(5)
        removed = rows[2]["hmac_sha256"]
        del rows[2]

        result = verify_chain(rows, documented_gaps=[removed])
        assert result.chain_valid is True
        assert result.tampered is False
        assert result.gaps[0]["documented"] is True

    def test_undeclared_gap_stays_invalid(self):
        rows = _chain(5)
        del rows[2]

        result = verify_chain(rows, documented_gaps=["some-unrelated-hmac"])
        assert result.chain_valid is False
        assert result.gaps[0]["documented"] is False

    def test_tampering_is_never_excused_by_a_documented_gap(self):
        rows = _chain(5)
        removed = rows[2]["hmac_sha256"]
        del rows[2]
        rows[2]["event_json"] = {"seq": 3, "injected": True}

        result = verify_chain(rows, documented_gaps=[removed])
        assert result.tampered is True
        assert result.chain_valid is False
