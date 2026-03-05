from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text

from ledger_app.services.snapshot_store import FileSystemSnapshotStore
from ledger_app.services.snapshot_store import SQLSnapshotStore
from ledger_app.services.snapshot_store import canonical_json
from ledger_app.services.snapshot_store import sha256_hex

_CASE_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"

_CREATE_TABLE_SQLITE = """
CREATE TABLE cbam_snapshots (
    id              TEXT NOT NULL PRIMARY KEY,
    case_id         TEXT NOT NULL,
    stage           TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    payload_json    TEXT NOT NULL,
    payload_hash    TEXT NOT NULL,
    parent_hash     TEXT,
    algo_versions   TEXT NOT NULL DEFAULT '{}',
    model_versions  TEXT NOT NULL DEFAULT '{}'
)
"""


@pytest.fixture()
def sql_store():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(text(_CREATE_TABLE_SQLITE))
    return SQLSnapshotStore(engine, table="cbam_snapshots")


def test_canonical_json_and_hash_are_deterministic_for_same_payload():
    payload_a = {"b": 2, "a": {"y": 2, "x": 1}}
    payload_b = {"a": {"x": 1, "y": 2}, "b": 2}

    json_a = canonical_json(payload_a)
    json_b = canonical_json(payload_b)

    assert json_a == json_b
    assert sha256_hex(json_a) == sha256_hex(json_b)


def test_filesystem_snapshot_store_chains_parent_hash_for_sequential_writes(tmp_path):
    store = FileSystemSnapshotStore(tmp_path / "snapshots")
    case_id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"

    first = store.append_snapshot(
        case_id=case_id,
        stage="extraction_v1",
        payload={"step": 1},
    )
    second = store.append_snapshot(
        case_id=case_id,
        stage="arbitrated_v1",
        payload={"step": 2},
    )

    assert first.parent_hash is None
    assert second.parent_hash == first.payload_hash

    files = list((tmp_path / "snapshots" / case_id).glob("*.json"))
    assert len(files) == 2


def test_sql_snapshot_store_chains_parent_hash_for_sequential_writes(sql_store):
    first = sql_store.append_snapshot(
        case_id=_CASE_ID,
        stage="extraction_v1",
        payload={"step": 1},
    )
    second = sql_store.append_snapshot(
        case_id=_CASE_ID,
        stage="arbitrated_v1",
        payload={"step": 2},
    )

    assert first.parent_hash is None
    assert second.parent_hash == first.payload_hash


def test_sql_snapshot_store_list_snapshots_returns_in_order(sql_store):
    sql_store.append_snapshot(case_id=_CASE_ID, stage="extraction_v1", payload={"n": 1})
    sql_store.append_snapshot(case_id=_CASE_ID, stage="arbitrated_v1", payload={"n": 2})
    sql_store.append_snapshot(case_id=_CASE_ID, stage="repaired_v1", payload={"n": 3})

    snapshots = sql_store.list_snapshots(_CASE_ID)

    assert len(snapshots) == 3
    assert [s.stage for s in snapshots] == ["extraction_v1", "arbitrated_v1", "repaired_v1"]


def test_sql_snapshot_store_latest_by_stage(sql_store):
    sql_store.append_snapshot(case_id=_CASE_ID, stage="extraction_v1", payload={"v": 1})
    sql_store.append_snapshot(case_id=_CASE_ID, stage="arbitrated_v1", payload={"v": 2})
    sql_store.append_snapshot(case_id=_CASE_ID, stage="extraction_v1", payload={"v": 3})

    latest = sql_store.latest_snapshot_by_stage(_CASE_ID, "extraction_v1")
    assert latest is not None
    import json
    assert json.loads(latest.payload_json) == {"v": 3}

    missing = sql_store.latest_snapshot_by_stage(_CASE_ID, "nonexistent_stage")
    assert missing is None
