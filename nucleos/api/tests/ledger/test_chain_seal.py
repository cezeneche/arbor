"""The Nucleos chain seals rather than being imported (Phase 4).

None of its entries backed a filed declaration or was shown to a supplier or
auditor, and the cases were samples, so importing them would mean guessing which
Arbor entity each belonged to — in the one part of the product whose purpose is
knowing exactly that.

Not importing is not the same as pretending the chain never existed. A chain that
simply stops, with no record of where, is indistinguishable from one that was
truncated. The seal is the difference.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from ledger_app.services.chain_seal import (
    SEAL_ALGORITHM,
    compute_chain_seal,
    seal_to_json,
)

pytestmark = pytest.mark.regulatory

FIXED = datetime(2026, 8, 10, 12, 0, 0, tzinfo=timezone.utc)


def _rows(n: int) -> list[dict]:
    return [
        {
            "id": f"row-{i}",
            "case_id": f"case-{i // 2}",
            "event_type": f"event_{i}",
            "signature": f"sig{i:02d}" * 8,
            "chain_hash": (f"sig{i - 1:02d}" * 8) if i else None,
            "created_at": datetime(2026, 5, 11 + i, 9, 0, 0, tzinfo=timezone.utc),
        }
        for i in range(n)
    ]


class TestSeal:
    def test_seals_an_ordered_chain(self):
        seal = compute_chain_seal(_rows(10), sealed_at=FIXED)
        assert seal.entry_count == 10
        assert seal.algorithm == SEAL_ALGORITHM
        assert seal.seal_hash
        assert seal.imported_into_arbor is False

    def test_records_the_window_the_chain_covered(self):
        seal = compute_chain_seal(_rows(3), sealed_at=FIXED)
        assert seal.first_event_at.startswith("2026-05-11")
        assert seal.last_event_at.startswith("2026-05-13")

    def test_the_final_signature_is_carried(self):
        rows = _rows(4)
        seal = compute_chain_seal(rows, sealed_at=FIXED)
        assert seal.final_signature == rows[-1]["signature"]

    def test_is_reproducible(self):
        a = compute_chain_seal(_rows(6), sealed_at=FIXED)
        b = compute_chain_seal(_rows(6), sealed_at=FIXED)
        assert a.seal_hash == b.seal_hash

    def test_commits_to_every_entry(self):
        rows = _rows(6)
        original = compute_chain_seal(rows, sealed_at=FIXED).seal_hash

        rows[3]["signature"] = "tampered" * 8
        assert compute_chain_seal(rows, sealed_at=FIXED).seal_hash != original

    def test_commits_to_the_order(self):
        rows = _rows(6)
        original = compute_chain_seal(rows, sealed_at=FIXED).seal_hash

        rows[2], rows[3] = rows[3], rows[2]
        assert compute_chain_seal(rows, sealed_at=FIXED).seal_hash != original

    def test_a_removed_entry_changes_the_seal(self):
        rows = _rows(6)
        original = compute_chain_seal(rows, sealed_at=FIXED).seal_hash

        del rows[2]
        assert compute_chain_seal(rows, sealed_at=FIXED).seal_hash != original

    def test_the_origin_is_part_of_the_hash(self):
        rows = _rows(4)
        a = compute_chain_seal(rows, origin="nucleos.cbam.audit_log", sealed_at=FIXED)
        b = compute_chain_seal(rows, origin="somewhere.else", sealed_at=FIXED)
        assert a.seal_hash != b.seal_hash

    def test_an_empty_chain_still_seals(self):
        """A chain with nothing in it is a fact worth recording, not an error."""
        seal = compute_chain_seal([], sealed_at=FIXED)
        assert seal.entry_count == 0
        assert seal.final_signature is None
        assert seal.seal_hash

    def test_unsigned_rows_are_counted_but_not_hashed(self):
        rows = _rows(4)
        signed_only = compute_chain_seal(rows, sealed_at=FIXED).seal_hash

        rows.append({"id": "x", "signature": None, "created_at": rows[-1]["created_at"]})
        widened = compute_chain_seal(rows, sealed_at=FIXED)

        assert widened.entry_count == 5
        assert widened.seal_hash == signed_only


class TestHandoff:
    def test_serialises_canonically_for_the_boundary(self):
        seal = compute_chain_seal(_rows(3), sealed_at=FIXED)
        first = seal_to_json(seal)
        assert seal_to_json(compute_chain_seal(_rows(3), sealed_at=FIXED)) == first
        assert '"imported_into_arbor":false' in first

    def test_the_payload_says_it_was_not_imported(self):
        """Arbor records this verbatim. A future reader must be able to tell that
        nothing crossed over, rather than inferring it from an absence."""
        seal = compute_chain_seal(_rows(3), sealed_at=FIXED)
        assert seal.to_dict()["imported_into_arbor"] is False
