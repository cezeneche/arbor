"""Seal the Nucleos audit chain.

Phase 4. Arbor's chain becomes the only one accepting writes. The Nucleos chain
is not imported — none of its entries backed a filed declaration or was shown to
a supplier or auditor, and its cases were sample data with no consequences, so
attaching them to real Arbor entities would mean guessing which company each
belonged to in the one part of the product whose purpose is knowing exactly that.

Not importing is not the same as pretending it never existed. A chain that simply
stops, with no record of where it stopped, is indistinguishable from a chain that
was truncated. Sealing produces a single verifiable fact — this chain existed,
it had this many entries, its final state hashed to this — which Arbor records as
the origin marker of its own chain.

The seal is computed over the stored signatures in order, so it commits to the
whole chain: change any entry and the seal no longer matches.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any

__all__ = ["ChainSeal", "SEAL_ALGORITHM", "compute_chain_seal", "seal_from_connection"]

SEAL_ALGORITHM = "SHA256-over-ordered-signatures-v1"


@dataclass(frozen=True)
class ChainSeal:
    """The final state of a chain that has stopped accepting writes."""

    origin: str
    algorithm: str
    entry_count: int
    first_event_at: str | None
    last_event_at: str | None
    final_signature: str | None
    seal_hash: str
    sealed_at: str
    imported_into_arbor: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def compute_chain_seal(
    rows: list[dict[str, Any]],
    origin: str = "nucleos.cbam.audit_log",
    sealed_at: datetime | None = None,
) -> ChainSeal:
    """Compute the seal over an ordered sequence of audit rows.

    Rows must be ordered by ``created_at ASC`` — the same order the chain was
    written and is verified in. Ordering is part of what the seal commits to:
    reordering the entries changes the hash.

    Unsigned rows are counted but contribute nothing to the hash, because they
    were never part of the chain's cryptographic guarantee and including them
    would make the seal depend on rows no signature covers.
    """
    signatures = [
        str(row.get("signature"))
        for row in rows
        if row.get("signature")
    ]

    digest = hashlib.sha256()
    digest.update(SEAL_ALGORITHM.encode("utf-8"))
    digest.update(b"\x00")
    digest.update(origin.encode("utf-8"))
    for signature in signatures:
        digest.update(b"\x00")
        digest.update(signature.encode("utf-8"))

    def _ts(row: dict[str, Any]) -> str | None:
        value = row.get("created_at")
        if value is None:
            return None
        return value.isoformat() if hasattr(value, "isoformat") else str(value)

    return ChainSeal(
        origin=origin,
        algorithm=SEAL_ALGORITHM,
        entry_count=len(rows),
        first_event_at=_ts(rows[0]) if rows else None,
        last_event_at=_ts(rows[-1]) if rows else None,
        final_signature=signatures[-1] if signatures else None,
        seal_hash=digest.hexdigest(),
        # Recorded rather than derived, so re-running the seal on the same rows
        # reproduces the same hash while still saying when it was taken.
        sealed_at=(sealed_at or datetime.now(timezone.utc)).isoformat(),
        imported_into_arbor=False,
    )


def seal_from_connection(conn: Any, origin: str = "nucleos.cbam.audit_log") -> ChainSeal:
    """Read the whole chain in order and seal it."""
    from sqlalchemy import text  # local import; keeps this module importable bare

    rows = conn.execute(
        text(
            """
            SELECT id, case_id, event_type, actor, payload, signature, chain_hash, created_at
            FROM cbam.audit_log
            ORDER BY created_at ASC
            """
        )
    ).mappings().all()
    return compute_chain_seal([dict(r) for r in rows], origin=origin)


def seal_to_json(seal: ChainSeal) -> str:
    """Canonical JSON, for handing the seal across the boundary to Arbor."""
    return json.dumps(seal.to_dict(), sort_keys=True, separators=(",", ":"))
