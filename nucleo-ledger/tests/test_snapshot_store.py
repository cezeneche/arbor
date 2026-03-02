from __future__ import annotations

from ledger_app.services.snapshot_store import FileSystemSnapshotStore
from ledger_app.services.snapshot_store import canonical_json
from ledger_app.services.snapshot_store import sha256_hex


def test_canonical_json_and_hash_are_deterministic_for_same_payload():
    payload_a = {"b": 2, "a": {"y": 2, "x": 1}}
    payload_b = {"a": {"x": 1, "y": 2}, "b": 2}

    json_a = canonical_json(payload_a)
    json_b = canonical_json(payload_b)

    assert json_a == json_b
    assert sha256_hex(json_a) == sha256_hex(json_b)


def test_filesystem_snapshot_store_chains_parent_hash_for_sequential_writes(tmp_path):
    store = FileSystemSnapshotStore(tmp_path / "snapshots")

    first = store.append_snapshot(
        case_id="CASE-001",
        stage="extraction_v1",
        payload={"step": 1},
    )
    second = store.append_snapshot(
        case_id="CASE-001",
        stage="arbitrated_v1",
        payload={"step": 2},
    )

    assert first.parent_hash is None
    assert second.parent_hash == first.payload_hash

    files = list((tmp_path / "snapshots" / "CASE-001").glob("*.json"))
    assert len(files) == 2
