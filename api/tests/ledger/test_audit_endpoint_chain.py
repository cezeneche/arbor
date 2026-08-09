"""The audit endpoint and audit_signer agree, and both separate gap from tamper.

The production cbam.audit_log names its columns signature / chain_hash / actor /
payload, while audit_signer works in hmac_sha256 / prev_hmac / actor_sub /
event_json. That mismatch was resolved by giving the endpoint its own copy of
the verification logic, which left two implementations of the same guarantee —
and only one of them learned to tell a documented gap from tampering. The
endpoint is the one an auditor actually calls.

There is now a single verifier and an adapter that renames the columns.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os

import pytest

os.environ.setdefault("AUDIT_SIGNING_KEY", "test-audit-signing-key")

from ledger_app.api.audit import (  # noqa: E402
    _to_signer_row,
    _verify_cbam_chain,
    _verify_cbam_event,
)
from ledger_app.services.audit_signer import verify_chain  # noqa: E402

pytestmark = pytest.mark.regulatory

CASE = "22222222-2222-2222-2222-222222222222"


def _sign(case_id: str, event_type: str, actor: str, payload: dict, chain_hash: str | None) -> str:
    payload_str = json.dumps(payload, sort_keys=True, default=str)
    msg = f"{case_id}|{event_type}|{actor}|{payload_str}|{chain_hash or ''}".encode()
    key = os.environ["AUDIT_SIGNING_KEY"].encode()
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def _row(i: int, chain_hash: str | None) -> dict:
    payload = {"seq": i}
    event_type = f"event_{i}"
    return {
        "id": f"row-{i}",
        "case_id": CASE,
        "event_type": event_type,
        "actor": "tester",
        "payload": payload,
        "chain_hash": chain_hash,
        "signature": _sign(CASE, event_type, "tester", payload, chain_hash),
    }


def _chain(n: int) -> list[dict]:
    rows: list[dict] = []
    prev: str | None = None
    for i in range(n):
        row = _row(i, prev)
        rows.append(row)
        prev = row["signature"]
    return rows


class TestColumnAdapter:
    def test_adapter_renames_every_column_the_signer_reads(self):
        row = _row(0, None)
        mapped = _to_signer_row(row)
        assert mapped["hmac_sha256"] == row["signature"]
        assert mapped["prev_hmac"] == row["chain_hash"]
        assert mapped["actor_sub"] == row["actor"]
        assert mapped["event_json"] == row["payload"]

    def test_event_verification_agrees_with_the_signer(self):
        row = _row(0, None)
        assert _verify_cbam_event(row) is True

    def test_unsigned_row_is_neither_valid_nor_tampered(self):
        row = _row(0, None)
        row["signature"] = None
        assert _verify_cbam_event(row) is None

    def test_altered_payload_fails_verification(self):
        row = _row(0, None)
        row["payload"] = {"seq": 0, "injected": True}
        assert _verify_cbam_event(row) is False


class TestEndpointChainSeparatesGapFromTamper:
    def test_intact_chain(self):
        result = _verify_cbam_chain(_chain(4))
        assert result["chain_valid"] is True
        assert result["tampered"] is False
        assert result["gaps"] == []

    def test_missing_row_is_a_gap(self):
        rows = _chain(5)
        del rows[2]
        result = _verify_cbam_chain(rows)
        assert result["tampered"] is False
        assert len(result["gaps"]) == 1
        assert result["chain_valid"] is False

    def test_altered_row_is_tampering(self):
        rows = _chain(4)
        rows[2]["payload"] = {"seq": 2, "injected": True}
        result = _verify_cbam_chain(rows)
        assert result["tampered"] is True
        assert result["chain_valid"] is False

    def test_endpoint_and_signer_reach_the_same_verdict(self):
        """One guarantee, one implementation — the adapter is the only difference."""
        rows = _chain(5)
        del rows[2]

        endpoint = _verify_cbam_chain(rows)
        signer = verify_chain([_to_signer_row(r) for r in rows])

        assert endpoint["chain_valid"] == signer.chain_valid
        assert endpoint["tampered"] == signer.tampered
        assert len(endpoint["gaps"]) == len(signer.gaps)
