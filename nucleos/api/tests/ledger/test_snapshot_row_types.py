"""Reading a snapshot back from Postgres.

Postgres hands back uuid, timestamptz and jsonb columns as UUID, datetime and
dict. SnapshotRecord declares them as strings, so every read on the SQL store
raised a ValidationError — which meant explain, which only reads snapshots, had
never worked against the production database. The file store, used in the fast
tests, writes strings and never showed it.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4

from ledger_app.services.snapshot_store import _row_to_snapshot


def test_a_postgres_row_reads_back_as_a_snapshot():
    case_id = uuid4()
    row = {
        "id": uuid4(),
        "case_id": case_id,
        "stage": "repaired_v1",
        "created_at": datetime(2027, 3, 15, 9, 30, tzinfo=timezone.utc),
        "payload_json": {"evidence": [{"field": "case.importer_eori"}]},
        "payload_hash": "a" * 64,
        "parent_hash": None,
        "algo_versions": {"builder": "v1"},
        "model_versions": "{}",
    }

    record = _row_to_snapshot(row)

    assert record.case_id == str(case_id)
    assert record.created_at.startswith("2027-03-15T09:30")
    assert json.loads(record.payload_json) == {"evidence": [{"field": "case.importer_eori"}]}
    assert record.algo_versions == {"builder": "v1"}


def test_string_columns_are_left_as_they_are():
    row = {
        "id": "snap-1",
        "case_id": "case-1",
        "stage": "repaired_v1",
        "created_at": "2027-03-15T09:30:00+00:00",
        "payload_json": '{"a": 1}',
        "payload_hash": "b" * 64,
    }
    record = _row_to_snapshot(row)
    assert (record.id, record.created_at, record.payload_json) == ("snap-1", "2027-03-15T09:30:00+00:00", '{"a": 1}')


def test_the_rebuilt_payload_hashes_as_it_was_written():
    # verify_chain recomputes the hash from payload_json, so the text rebuilt
    # from jsonb has to be the canonical form the hash was taken over.
    from ledger_app.services.snapshot_store import canonical_json, sha256_hex

    payload = {"importer": "Société Générale d’Aciers", "lines": [{"mass": 24000}]}
    row = {
        "id": uuid4(), "case_id": uuid4(), "stage": "repaired_v1",
        "created_at": datetime.now(timezone.utc), "payload_json": payload,
        "payload_hash": sha256_hex(canonical_json(payload)),
    }
    record = _row_to_snapshot(row)
    assert sha256_hex(record.payload_json) == record.payload_hash
