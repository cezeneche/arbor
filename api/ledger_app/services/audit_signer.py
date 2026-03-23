"""
HMAC-SHA256 signing and verification for audit log entries.

Every INSERT into audit_log includes an hmac_sha256 column signed over:
    "{case_id}|{event_type}|{actor_sub}|{canonical_event_json}|{prev_hmac}"

where ``prev_hmac`` is the hmac_sha256 of the preceding signed row for the
same case (empty string for the first row of a case).  This hash chain makes
deletion or reordering of rows detectable via ``verify_chain()``.

Backward compatibility:
    Rows written before this chain was introduced (migration 004_audit_chain.sql)
    were signed WITHOUT the trailing ``|{prev_hmac}`` suffix.  ``verify_event()``
    tries the chained format first, then falls back to the legacy format
    transparently, so old rows continue to verify correctly.

Key:
    AUDIT_SIGNING_KEY env var — required; service refuses to start without it.
    Must differ from JWT_SECRET so a JWT compromise cannot forge audit logs.

Immutable S3 export:
    export_to_s3_immutable() writes a GOVERNANCE-locked NDJSON archive to S3
    that cannot be deleted or modified for the retention period (default: 30 days).
    Requires the S3 bucket to have Object Lock enabled.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

_logger = logging.getLogger("ledger.audit_signer")


def _get_signing_key() -> bytes:
    key = os.getenv("AUDIT_SIGNING_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "AUDIT_SIGNING_KEY is not set. "
            "Set a dedicated signing key distinct from JWT_SECRET."
        )
    return key.encode("utf-8")


# ── Signing ───────────────────────────────────────────────────────────────────

def sign_event(
    case_id: str,
    event_type: str,
    actor_sub: str,
    event_json_str: str,
    *,
    prev_hmac: str | None = None,
) -> str:
    """
    Compute HMAC-SHA256 hex digest over the canonical audit event payload.

    Parameters
    ----------
    case_id:
        UUID of the case (or "" for system events).
    event_type:
        e.g. "case_created", "doc_uploaded".
    actor_sub:
        JWT sub of the actor (user ID) or "system".
    event_json_str:
        Canonical JSON string of the event payload (keys sorted).
    prev_hmac:
        hmac_sha256 of the preceding signed row for this case.
        Pass ``None`` or ``""`` for the first row of a case.
        When provided, the chain link is included in the HMAC message so
        deletion or reordering of rows is detectable.
    """
    chain_link = prev_hmac or ""
    msg = (
        f"{case_id}|{event_type}|{actor_sub}|{event_json_str}|{chain_link}"
    ).encode("utf-8")
    return hmac.new(_get_signing_key(), msg, hashlib.sha256).hexdigest()


# ── Chain helper ──────────────────────────────────────────────────────────────

def get_prev_chain_hmac(case_id: str, conn: Any) -> str | None:
    """
    Return the hmac_sha256 of the most recent signed audit row for *case_id*.

    Must be called on the **same connection** (and preferably within the same
    transaction) as the subsequent INSERT so that concurrent writes for the
    same case are serialised correctly.

    Returns ``None`` when no prior signed row exists for this case (the new
    row will be the first link in the chain).
    """
    from sqlalchemy import text  # local import to keep module importable without SA

    row = conn.execute(
        text("""
            SELECT signature FROM cbam.audit_log
            WHERE case_id = :case_id AND signature IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1
        """),
        {"case_id": case_id},
    ).fetchone()
    return row[0] if row else None


# ── Verification ──────────────────────────────────────────────────────────────

def verify_event(row: Mapping[str, Any]) -> bool | None:
    """
    Verify the HMAC of a stored audit_log row.

    Supports both the current chained format and the legacy pre-chain format:
    - Chained:  HMAC(... | prev_hmac)
    - Legacy:   HMAC(...)             [no chain suffix]

    Returns:
        True  — HMAC present and matches (either format)
        False — HMAC present but does NOT match (tampered)
        None  — HMAC absent (unsigned legacy row)
    """
    stored_hmac = row.get("hmac_sha256") or ""
    if not stored_hmac:
        return None  # unsigned / pre-signing legacy row

    event_json = row.get("event_json") or {}
    try:
        event_json_str = json.dumps(event_json, sort_keys=True, default=str)
    except Exception:
        return False

    case_id  = str(row.get("case_id") or "")
    evt_type = str(row.get("event_type") or "")
    actor    = str(row.get("actor_sub") or "")

    # Pass 1: chained format — prev_hmac present (None means first-in-chain → "")
    chain_link = row.get("prev_hmac")  # None for legacy rows; "" or str for chained
    expected_chained = sign_event(case_id, evt_type, actor, event_json_str,
                                  prev_hmac=chain_link)
    if hmac.compare_digest(expected_chained, stored_hmac):
        return True

    # Pass 2: legacy format (rows written before hash chain was introduced).
    # Old message format had no |chain_link suffix.
    old_msg = f"{case_id}|{evt_type}|{actor}|{event_json_str}".encode("utf-8")
    expected_legacy = hmac.new(_get_signing_key(), old_msg, hashlib.sha256).hexdigest()
    if hmac.compare_digest(expected_legacy, stored_hmac):
        return True

    return False


# ── Chain verification ────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ChainVerificationResult:
    """Result of a full hash-chain verification across an ordered row sequence.

    Attributes
    ----------
    chain_valid :
        True when every signed row's HMAC is correct AND every chained row's
        prev_hmac equals the HMAC of the preceding signed row.
    signed_count :
        Number of rows that carry an hmac_sha256 value.
    chained_count :
        Number of rows that carry a non-null/non-empty prev_hmac (post-chain rows).
    broken_at_index :
        0-based index of the first row where the chain breaks, or None.
    issues :
        Human-readable descriptions of each integrity violation found.
    """
    chain_valid: bool
    signed_count: int
    chained_count: int
    broken_at_index: int | None
    issues: list[str] = field(default_factory=list)


def verify_chain(rows: list[dict[str, Any]]) -> ChainVerificationResult:
    """
    Verify the hash chain across an ordered sequence of audit_log rows.

    Rows must be ordered by ``created_at ASC`` (the order returned by the
    audit-log API endpoint).

    Chain integrity requires:
    1. Each signed row's HMAC must verify correctly (``verify_event`` passes).
    2. Each chained row's ``prev_hmac`` must equal the ``hmac_sha256`` of the
       most recent preceding signed row.  If no prior signed row exists,
       ``prev_hmac`` should be ``None`` or ``""``.

    Unsigned rows (no ``hmac_sha256``) are skipped for chain purposes.
    """
    signed_count = 0
    chained_count = 0
    issues: list[str] = []
    broken_at_index: int | None = None
    last_signed_hmac: str | None = None  # hmac_sha256 of last signed row seen

    for i, row in enumerate(rows):
        row_hmac = row.get("hmac_sha256") or ""
        if not row_hmac:
            # Unsigned / pre-signing row — does not participate in chain.
            continue

        signed_count += 1
        row_prev_hmac = row.get("prev_hmac")  # None, "", or hex string

        # Check chain link when this row carries a prev_hmac pointer.
        if row_prev_hmac:
            chained_count += 1
            if last_signed_hmac is None:
                issues.append(
                    f"row[{i}] id={str(row.get('id'))!r}: "
                    f"prev_hmac set but no prior signed row in sequence"
                )
                if broken_at_index is None:
                    broken_at_index = i
            elif row_prev_hmac != last_signed_hmac:
                issues.append(
                    f"row[{i}] id={str(row.get('id'))!r}: "
                    f"prev_hmac mismatch — expected {last_signed_hmac[:16]!r}... "
                    f"got {row_prev_hmac[:16]!r}..."
                )
                if broken_at_index is None:
                    broken_at_index = i

        # Verify the row's own HMAC (format-agnostic via verify_event).
        ok = verify_event(row)
        if ok is False:
            issues.append(
                f"row[{i}] id={str(row.get('id'))!r}: "
                f"HMAC verification failed (tampered or key mismatch)"
            )
            if broken_at_index is None:
                broken_at_index = i

        # Advance chain pointer to the actual stored HMAC of this row.
        last_signed_hmac = row_hmac

    chain_valid = broken_at_index is None
    return ChainVerificationResult(
        chain_valid=chain_valid,
        signed_count=signed_count,
        chained_count=chained_count,
        broken_at_index=broken_at_index,
        issues=issues,
    )


# ── S3 immutable export ───────────────────────────────────────────────────────

def export_to_s3_immutable(
    case_id: str,
    rows: list[dict[str, Any]],
    s3_client: Any,
    bucket: str,
    retention_days: int = 30,
    tenant_id: str = "shared",
) -> str:
    """
    Write a GOVERNANCE-locked NDJSON audit archive to S3.

    The object cannot be deleted or modified until the retention period expires.
    Requires the S3 bucket to have Object Lock enabled (set at bucket creation time).

    Parameters
    ----------
    case_id:
        Case UUID (used in the S3 key path).
    rows:
        Audit log rows to archive (dicts with hmac_sha256 and prev_hmac included).
    s3_client:
        boto3 S3 client.
    bucket:
        S3 bucket name (must have Object Lock enabled).
    retention_days:
        GOVERNANCE lock retention period (default 30 days).

    Returns
    -------
    str
        S3 URI of the created archive object.
    """
    retain_until = datetime.now(timezone.utc) + timedelta(days=retention_days)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_tenant = (tenant_id or "shared").replace("/", "_")
    key = f"tenants/{safe_tenant}/audit-archives/{case_id}/{timestamp}.ndjson"

    body = "\n".join(json.dumps(r, default=str, sort_keys=True) for r in rows)

    try:
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=body.encode("utf-8"),
            ContentType="application/x-ndjson",
            ServerSideEncryption="AES256",
            ObjectLockMode="GOVERNANCE",
            ObjectLockRetainUntilDate=retain_until,
        )
        _logger.info(
            "audit_export_immutable case_id=%s s3_key=%s retain_until=%s",
            case_id,
            key,
            retain_until.isoformat(),
        )
    except Exception as exc:
        _logger.error(
            "audit_export_object_lock_failed case_id=%s error=%s",
            case_id,
            exc,
        )
        raise RuntimeError(
            f"Audit export failed: S3 Object Lock could not be applied on bucket '{bucket}'. "
            "Enable Object Lock at bucket creation time to ensure audit immutability. "
            f"Original error: {exc}"
        ) from exc

    return f"s3://{bucket}/{key}"
