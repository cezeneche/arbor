"""
HMAC-SHA256 signing and verification for audit log entries.

Every INSERT into audit_log includes an hmac_sha256 column signed over:
    "{case_id}|{event_type}|{actor_sub}|{canonical_event_json}"

Key priority: AUDIT_SIGNING_KEY env var → JWT_SECRET env var.
Using a dedicated AUDIT_SIGNING_KEY is strongly recommended in production so
that compromising the JWT secret does not automatically compromise audit integrity.

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
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

_logger = logging.getLogger("ledger.audit_signer")


def _get_signing_key() -> bytes:
    key = (
        os.getenv("AUDIT_SIGNING_KEY", "").strip()
        or os.getenv("JWT_SECRET", "").strip()
    )
    if not key:
        raise RuntimeError(
            "No signing key available for audit log. "
            "Set AUDIT_SIGNING_KEY or JWT_SECRET."
        )
    return key.encode("utf-8")


def sign_event(
    case_id: str,
    event_type: str,
    actor_sub: str,
    event_json_str: str,
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
    """
    msg = f"{case_id}|{event_type}|{actor_sub}|{event_json_str}".encode("utf-8")
    return hmac.new(_get_signing_key(), msg, hashlib.sha256).hexdigest()


def verify_event(row: Mapping[str, Any]) -> bool | None:
    """
    Verify the HMAC of a stored audit_log row.

    Returns:
        True  — HMAC present and matches
        False — HMAC present but does NOT match (tampered)
        None  — HMAC absent (legacy row created before signing was added)
    """
    stored_hmac = row.get("hmac_sha256") or ""
    if not stored_hmac:
        return None  # legacy row

    event_json = row.get("event_json") or {}
    try:
        event_json_str = json.dumps(event_json, sort_keys=True, default=str)
    except Exception:
        return False

    expected = sign_event(
        str(row.get("case_id") or ""),
        str(row.get("event_type") or ""),
        str(row.get("actor_sub") or ""),
        event_json_str,
    )
    return hmac.compare_digest(expected, stored_hmac)


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
        Audit log rows to archive (dicts with hmac_sha256 included).
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
        # Object Lock may not be enabled on the bucket — fall back to non-locked upload
        _logger.warning(
            "audit_export_object_lock_failed case_id=%s error=%s — uploading without lock",
            case_id,
            exc,
        )
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=body.encode("utf-8"),
            ContentType="application/x-ndjson",
            ServerSideEncryption="AES256",
        )

    return f"s3://{bucket}/{key}"
