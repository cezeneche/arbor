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


__all__ = [
    "SnapshotRecord",
    "SnapshotStore",
    "FileSystemSnapshotStore",
    "SQLSnapshotStore",
    "ChainIntegrityError",
    "canonical_json",
    "sha256_hex",
    "bytes_sha256_hex",
    "get_snapshot_store",
]


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


def bytes_sha256_hex(data: bytes) -> str:
    """SHA-256 of raw binary data (e.g. original PDF bytes).

    Use this — not sha256_hex() — when hashing file uploads.  sha256_hex()
    first encodes a string to UTF-8, so it cannot reliably round-trip binary
    content and would not produce the standard IETF/X.509 file hash.
    """
    return hashlib.sha256(data).hexdigest()


class ChainIntegrityError(RuntimeError):
    """Raised when a snapshot's parent_hash does not match the previous record's hash.

    This indicates tampering or corruption of the audit chain (CLAUDE.md Rule 5).
    Human review is required before any new snapshots are written.
    """


def _verify_chain(records: list["SnapshotRecord"]) -> None:
    """Verify every link in an ordered list of snapshot records.

    Called when reading the full chain so that tampering between writes is
    detected before any output is generated (CLAUDE.md Rule 5).

    Parameters
    ----------
    records:
        All snapshots for a case, ordered by created_at ascending.

    Raises
    ------
    ChainIntegrityError
        When any record's payload_hash does not match its recomputed hash,
        when a non-first record has a null parent_hash (injected orphan),
        or when any record's parent_hash does not match its predecessor's payload_hash.
    """
    for i, curr in enumerate(records):
        # Recompute and verify payload integrity for every record.
        recomputed = sha256_hex(curr.payload_json)
        if recomputed != curr.payload_hash:
            raise ChainIntegrityError(
                f"Audit chain payload tampered at position {i}: "
                f"record id={curr.id!r} (stage={curr.stage!r}) stored "
                f"payload_hash={curr.payload_hash!r} but recomputed "
                f"hash={recomputed!r}. "
                "Human review is required (CLAUDE.md Rule 5)."
            )
        if i == 0:
            continue  # first record — no predecessor link to verify
        prev = records[i - 1]
        if curr.parent_hash is None:
            raise ChainIntegrityError(
                f"Audit chain integrity violation at position {i}: "
                f"record id={curr.id!r} (stage={curr.stage!r}) has a null "
                f"parent_hash but is not the first record in the chain. "
                "This indicates an injected or orphaned snapshot. "
                "Human review is required (CLAUDE.md Rule 5)."
            )
        if curr.parent_hash != prev.payload_hash:
            raise ChainIntegrityError(
                f"Audit chain integrity violation at position {i}: "
                f"record id={curr.id!r} (stage={curr.stage!r}) claims "
                f"parent_hash={curr.parent_hash!r} but predecessor "
                f"id={prev.id!r} (stage={prev.stage!r}) has "
                f"payload_hash={prev.payload_hash!r}. "
                "This may indicate tampering or corruption between writes. "
                "Human review is required (CLAUDE.md Rule 5)."
            )


def _verify_chain_link(previous: "SnapshotRecord | None", claimed_parent_hash: "str | None") -> None:
    """Assert that *claimed_parent_hash* matches the hash of *previous*.

    Called at write-time before inserting a new snapshot — enforces that the
    chain is unbroken.  Per CLAUDE.md Rule 5, a broken chain requires human
    review before any further output is generated.

    Parameters
    ----------
    previous:
        The most recent SnapshotRecord for this case (None if this is the first).
    claimed_parent_hash:
        The parent_hash the caller is asserting for the new snapshot.
        When None, the store will auto-resolve it from *previous* — this function
        only verifies an explicitly supplied value.

    Raises
    ------
    ChainIntegrityError
        When claimed_parent_hash does not match previous.payload_hash.
    """
    if claimed_parent_hash is None or previous is None:
        return  # auto-resolve path or first snapshot — nothing to verify
    if claimed_parent_hash != previous.payload_hash:
        raise ChainIntegrityError(
            f"Audit chain integrity violation: claimed parent_hash "
            f"{claimed_parent_hash!r} does not match the stored predecessor hash "
            f"{previous.payload_hash!r} (stage={previous.stage!r}, id={previous.id!r}). "
            "This may indicate tampering or concurrent writes. "
            "Human review is required before any new snapshots can be appended "
            "(CLAUDE.md Rule 5)."
        )


class FileSystemSnapshotStore:
    def __init__(self, root_dir: Path):
        self.root_dir = root_dir
        self.root_dir.mkdir(parents=True, exist_ok=True)

    def _case_dir(self, case_id: str) -> Path:
        try:
            UUID(case_id)
        except (ValueError, AttributeError):
            raise ValueError(f"Invalid case_id — must be a UUID: {case_id!r}")
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
        _verify_chain(snapshots)
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

        previous = self.latest_snapshot(case_id)

        # ── Write-time chain verification (CLAUDE.md Rule 5) ─────────────────
        # If the caller supplies an explicit parent_hash, verify it matches the
        # stored predecessor before accepting the write.  This detects tampering
        # or concurrent writes that would silently corrupt the chain.
        _verify_chain_link(previous, parent_hash)

        if parent_hash is None:
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


def _row_to_snapshot(row: Any) -> SnapshotRecord:
    d = dict(row)
    for field in ("algo_versions", "model_versions"):
        v = d.get(field)
        if isinstance(v, str):
            try:
                d[field] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                d[field] = {}
    return SnapshotRecord.model_validate(d)


class SQLSnapshotStore:
    """Append-only SQL-backed snapshot store for CBAM audit chain persistence.

    Requires the ``cbam.cbam_snapshots`` table created by migration
    ``004_cbam_snapshots.sql``.  Pass ``table="cbam_snapshots"`` (no schema
    prefix) when using SQLite in tests.
    """

    def __init__(self, engine: Any, table: str = "cbam.cbam_snapshots") -> None:
        from sqlalchemy import text as _text  # local import avoids top-level SA dep

        self._engine = engine
        self._table = table
        self._text = _text

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

        with self._engine.begin() as conn:
            row = conn.execute(
                self._text(
                    f"SELECT payload_hash, stage, id FROM {self._table}"
                    f" WHERE case_id = :case_id ORDER BY created_at DESC LIMIT 1"
                ),
                {"case_id": case_id},
            ).mappings().one_or_none()

            stored_predecessor_hash = row["payload_hash"] if row else None

            # ── Write-time chain verification (CLAUDE.md Rule 5) ─────────────
            # When an explicit parent_hash is supplied, verify it matches the
            # stored predecessor before accepting the write.
            if parent_hash is not None and stored_predecessor_hash is not None:
                if parent_hash != stored_predecessor_hash:
                    raise ChainIntegrityError(
                        f"Audit chain integrity violation (SQL store): "
                        f"claimed parent_hash {parent_hash!r} does not match "
                        f"stored predecessor hash {stored_predecessor_hash!r} "
                        f"(stage={row['stage']!r}, id={row['id']!r}). "
                        "Human review required (CLAUDE.md Rule 5)."
                    )

            if parent_hash is None:
                parent_hash = stored_predecessor_hash

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

            conn.execute(
                self._text(
                    f"INSERT INTO {self._table}"
                    f" (id, case_id, stage, created_at, payload_json, payload_hash,"
                    f"  parent_hash, algo_versions, model_versions)"
                    f" VALUES (:id, :case_id, :stage, :created_at, :payload_json,"
                    f"  :payload_hash, :parent_hash, :algo_versions, :model_versions)"
                ),
                {
                    "id": record.id,
                    "case_id": record.case_id,
                    "stage": record.stage,
                    "created_at": record.created_at,
                    "payload_json": record.payload_json,
                    "payload_hash": record.payload_hash,
                    "parent_hash": record.parent_hash,
                    "algo_versions": json.dumps(record.algo_versions),
                    "model_versions": json.dumps(record.model_versions),
                },
            )

        return record

    def latest_snapshot(self, case_id: str) -> SnapshotRecord | None:
        with self._engine.begin() as conn:
            row = conn.execute(
                self._text(
                    f"SELECT * FROM {self._table}"
                    f" WHERE case_id = :case_id ORDER BY created_at DESC LIMIT 1"
                ),
                {"case_id": case_id},
            ).mappings().one_or_none()
        return _row_to_snapshot(row) if row else None

    def list_snapshots(self, case_id: str) -> list[SnapshotRecord]:
        with self._engine.begin() as conn:
            rows = conn.execute(
                self._text(
                    f"SELECT * FROM {self._table}"
                    f" WHERE case_id = :case_id ORDER BY created_at ASC"
                ),
                {"case_id": case_id},
            ).mappings().all()
        snapshots = [_row_to_snapshot(r) for r in rows]
        _verify_chain(snapshots)
        return snapshots

    def latest_snapshot_by_stage(self, case_id: str, stage: str) -> SnapshotRecord | None:
        with self._engine.begin() as conn:
            row = conn.execute(
                self._text(
                    f"SELECT * FROM {self._table}"
                    f" WHERE case_id = :case_id AND stage = :stage"
                    f" ORDER BY created_at DESC LIMIT 1"
                ),
                {"case_id": case_id, "stage": stage},
            ).mappings().one_or_none()
        return _row_to_snapshot(row) if row else None


def _default_snapshot_dir() -> Path:
    override = os.getenv("SNAPSHOT_STORE_DIR")
    if override:
        return Path(override)
    return Path(tempfile.gettempdir()) / "cbam_snapshots"


def get_snapshot_store() -> SnapshotStore:
    backend = os.getenv("SNAPSHOT_STORE_BACKEND", "").strip().lower()
    if not backend:
        # SNAPSHOT_STORE_DIR is a filesystem-specific config; treat it as an implicit override.
        if os.getenv("SNAPSHOT_STORE_DIR"):
            backend = "filesystem"
        else:
            db_url = os.getenv("DATABASE_URL", "")
            # Auto-select SQL backend only for non-SQLite databases.
            # SQLite (used in tests) lacks the cbam schema and cbam_snapshots table.
            backend = "sql" if (db_url and "sqlite" not in db_url.lower()) else "filesystem"

    if backend == "sql":
        from ledger_app.db.session import engine as _engine  # lazy — avoids circular import
        return SQLSnapshotStore(_engine)
    return FileSystemSnapshotStore(_default_snapshot_dir())
