from __future__ import annotations

import hashlib
import json
import os
from datetime import date
from datetime import datetime
from datetime import timezone
from decimal import Decimal
from pathlib import Path
import tempfile
from typing import Any
from typing import Protocol
from uuid import UUID
from uuid import uuid4

from pydantic import BaseModel
from pydantic import Field


class SnapshotRecord(BaseModel):
    id: str
    case_id: str
    stage: str
    created_at: str
    payload_json: str
    payload_hash: str
    parent_hash: str | None = None
    algo_versions: dict[str, Any] = Field(default_factory=dict)
    model_versions: dict[str, Any] = Field(default_factory=dict)


class SnapshotStore(Protocol):
    def append_snapshot(
        self,
        *,
        case_id: str,
        stage: str,
        payload: Any,
        algo_versions: dict[str, Any] | None = None,
        model_versions: dict[str, Any] | None = None,
        parent_hash: str | None = None,
    ) -> SnapshotRecord:
        ...

    def latest_snapshot(self, case_id: str) -> SnapshotRecord | None:
        ...

    def list_snapshots(self, case_id: str) -> list[SnapshotRecord]:
        ...

    def latest_snapshot_by_stage(self, case_id: str, stage: str) -> SnapshotRecord | None:
        ...


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, UUID):
        return str(value)
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def canonical_json(payload: Any) -> str:
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=_json_default,
    )


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class FileSystemSnapshotStore:
    def __init__(self, root_dir: Path):
        self.root_dir = root_dir
        self.root_dir.mkdir(parents=True, exist_ok=True)

    def _case_dir(self, case_id: str) -> Path:
        case_dir = self.root_dir / case_id
        case_dir.mkdir(parents=True, exist_ok=True)
        return case_dir

    def _snapshot_file(self, case_id: str, snapshot_id: str, created_at: str) -> Path:
        safe_created_at = created_at.replace(":", "").replace("-", "")
        return self._case_dir(case_id) / f"{safe_created_at}_{snapshot_id}.json"

    def latest_snapshot(self, case_id: str) -> SnapshotRecord | None:
        case_dir = self._case_dir(case_id)
        files = sorted(case_dir.glob("*.json"))
        if not files:
            return None
        latest_file = files[-1]
        payload = json.loads(latest_file.read_text(encoding="utf-8"))
        return SnapshotRecord.model_validate(payload)

    def list_snapshots(self, case_id: str) -> list[SnapshotRecord]:
        case_dir = self._case_dir(case_id)
        files = sorted(case_dir.glob("*.json"))
        snapshots: list[SnapshotRecord] = []
        for path in files:
            payload = json.loads(path.read_text(encoding="utf-8"))
            snapshots.append(SnapshotRecord.model_validate(payload))
        return snapshots

    def latest_snapshot_by_stage(self, case_id: str, stage: str) -> SnapshotRecord | None:
        for snapshot in reversed(self.list_snapshots(case_id)):
            if snapshot.stage == stage:
                return snapshot
        return None

    def append_snapshot(
        self,
        *,
        case_id: str,
        stage: str,
        payload: Any,
        algo_versions: dict[str, Any] | None = None,
        model_versions: dict[str, Any] | None = None,
        parent_hash: str | None = None,
    ) -> SnapshotRecord:
        payload_json = canonical_json(payload)
        payload_hash = sha256_hex(payload_json)
        created_at = datetime.now(timezone.utc).isoformat()

        if parent_hash is None:
            previous = self.latest_snapshot(case_id)
            parent_hash = previous.payload_hash if previous else None

        record = SnapshotRecord(
            id=str(uuid4()),
            case_id=case_id,
            stage=stage,
            created_at=created_at,
            payload_json=payload_json,
            payload_hash=payload_hash,
            parent_hash=parent_hash,
            algo_versions=algo_versions or {},
            model_versions=model_versions or {},
        )

        path = self._snapshot_file(case_id, record.id, record.created_at)
        path.write_text(record.model_dump_json(indent=2), encoding="utf-8")
        return record


class SQLSnapshotStore:
    """Interface placeholder for future SQL-backed append-only snapshots."""

    def append_snapshot(
        self,
        *,
        case_id: str,
        stage: str,
        payload: Any,
        algo_versions: dict[str, Any] | None = None,
        model_versions: dict[str, Any] | None = None,
        parent_hash: str | None = None,
    ) -> SnapshotRecord:
        raise NotImplementedError("SQLSnapshotStore is not implemented yet")

    def latest_snapshot(self, case_id: str) -> SnapshotRecord | None:
        raise NotImplementedError("SQLSnapshotStore is not implemented yet")

    def list_snapshots(self, case_id: str) -> list[SnapshotRecord]:
        raise NotImplementedError("SQLSnapshotStore is not implemented yet")

    def latest_snapshot_by_stage(self, case_id: str, stage: str) -> SnapshotRecord | None:
        raise NotImplementedError("SQLSnapshotStore is not implemented yet")


def _default_snapshot_dir() -> Path:
    override = os.getenv("SNAPSHOT_STORE_DIR")
    if override:
        return Path(override)

    # Keep test runs isolated from repository fixtures unless explicitly requested.
    if os.getenv("PYTEST_CURRENT_TEST"):
        return Path(tempfile.gettempdir()) / "cbam_snapshots"

    repo_root = Path(__file__).resolve().parents[3]
    return repo_root / "fixtures" / "ledger" / "snapshots"


def get_snapshot_store() -> SnapshotStore:
    backend = os.getenv("SNAPSHOT_STORE_BACKEND", "filesystem").strip().lower()
    if backend == "sql":
        return SQLSnapshotStore()
    return FileSystemSnapshotStore(_default_snapshot_dir())
