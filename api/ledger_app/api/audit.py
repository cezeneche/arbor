"""
Audit log endpoint: retrieve and verify the signed CBAM audit trail per case.

GET /api/cases/{case_id}/audit-log
    Returns all audit events from cbam.audit_log for a CBAM case with per-row
    HMAC verification and full chain integrity status.

    - verified: true  — HMAC present and matches
    - verified: false — HMAC present but tampered
    - verified: null  — unsigned row (no signature stored)
    - chain_valid: true  — every signed row's chain_hash links to its predecessor
    - chain_valid: false — at least one row is missing, reordered, or tampered

GET /api/cases/{case_id}/audit-log?export=true
    Additionally exports the audit log to S3 with GOVERNANCE Object Lock.
    Returns the storage_uri of the archive.

All events are stored in cbam.audit_log with columns:
    id, tenant_id, case_id, event_type, actor, payload, signature, chain_hash, created_at

The HMAC chain uses cbam.audit_log.signature (computed over event content +
chain_hash of the prior row) to make deletion or reordering detectable.
"""
from __future__ import annotations

import hashlib
import hmac as _hmac
import json
import logging
import os

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import text

from ledger_app.api.cbam._shared import engine as _cbam_engine

log = logging.getLogger("nucleos.audit")

router = APIRouter(tags=["audit"])


def _verify_cbam_event(row: dict) -> bool | None:
    """
    Verify the HMAC signature of a cbam.audit_log row.

    cbam.audit_log uses column names that differ from the legacy audit_log:
        signature  ↔  hmac_sha256
        chain_hash ↔  prev_hmac
        actor      ↔  actor_sub
        payload    ↔  event_json

    Returns:
        True  — signature present and matches
        False — signature present but does NOT match (tampered)
        None  — no signature (unsigned row)
    """
    stored_sig = row.get("signature") or ""
    if not stored_sig:
        return None

    payload = row.get("payload") or {}
    try:
        payload_str = json.dumps(payload, sort_keys=True, default=str)
    except Exception:
        return False

    case_id    = str(row.get("case_id") or "")
    event_type = str(row.get("event_type") or "")
    actor      = str(row.get("actor") or "")
    chain_hash = row.get("chain_hash")  # None for first row, str for chained

    key = os.getenv("AUDIT_SIGNING_KEY", "").strip().encode("utf-8")
    if not key:
        return None  # cannot verify without the signing key

    chain_link = chain_hash or ""
    msg = f"{case_id}|{event_type}|{actor}|{payload_str}|{chain_link}".encode("utf-8")
    expected = _hmac.new(key, msg, hashlib.sha256).hexdigest()

    if _hmac.compare_digest(expected, stored_sig):
        return True

    # Fallback: legacy format without chain suffix (rows before chain was added)
    old_msg = f"{case_id}|{event_type}|{actor}|{payload_str}".encode("utf-8")
    expected_legacy = _hmac.new(key, old_msg, hashlib.sha256).hexdigest()
    return _hmac.compare_digest(expected_legacy, stored_sig)


def _verify_cbam_chain(rows: list[dict]) -> dict:
    """
    Verify the hash chain across an ordered sequence of cbam.audit_log rows.

    Returns a dict with chain_valid, signed_count, chained_count, issues.
    """
    signed_count = 0
    chained_count = 0
    issues: list[str] = []
    broken_at: int | None = None
    last_sig: str | None = None

    for i, row in enumerate(rows):
        sig = row.get("signature") or ""
        if not sig:
            continue

        signed_count += 1
        chain_hash = row.get("chain_hash")

        if chain_hash:
            chained_count += 1
            if last_sig is None:
                issues.append(
                    f"row[{i}] id={str(row.get('id'))!r}: "
                    "chain_hash set but no prior signed row in sequence"
                )
                if broken_at is None:
                    broken_at = i
            elif chain_hash != last_sig:
                issues.append(
                    f"row[{i}] id={str(row.get('id'))!r}: "
                    f"chain_hash mismatch — expected {last_sig[:16]!r}... "
                    f"got {chain_hash[:16]!r}..."
                )
                if broken_at is None:
                    broken_at = i

        ok = _verify_cbam_event(row)
        if ok is False:
            issues.append(
                f"row[{i}] id={str(row.get('id'))!r}: "
                "HMAC verification failed (tampered or key mismatch)"
            )
            if broken_at is None:
                broken_at = i

        last_sig = sig

    return {
        "chain_valid":     broken_at is None,
        "signed_count":    signed_count,
        "chained_count":   chained_count,
        "broken_at_index": broken_at,
        "issues":          issues,
    }


@router.get("/cases/{case_id}/audit-log")
def get_audit_log(
    request: Request,
    case_id: str,
    export: bool = Query(default=False, description="Export to S3 with Object Lock"),
):
    with _cbam_engine.connect() as conn:
        # Verify the case exists in the CBAM schema
        exists = conn.execute(
            text("SELECT 1 FROM cbam.cbam_cases WHERE id = :id LIMIT 1"),
            {"id": case_id},
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Case not found")

        rows = conn.execute(
            text("""
                SELECT id, tenant_id, case_id, event_type, actor,
                       payload, signature, chain_hash, created_at
                FROM cbam.audit_log
                WHERE case_id = :case_id
                ORDER BY created_at ASC
            """),
            {"case_id": case_id},
        ).mappings().all()

    result_rows = []
    for row in rows:
        r = dict(row)
        # Ensure payload is a dict — some driver configurations return JSONB as a string.
        if isinstance(r.get("payload"), str):
            try:
                import json as _json
                r["payload"] = _json.loads(r["payload"])
            except Exception:
                r["payload"] = {}
        r["verified"] = _verify_cbam_event(r)
        result_rows.append(r)

    chain = _verify_cbam_chain(result_rows)

    response: dict = {
        "case_id":            case_id,
        "count":              len(result_rows),
        "chain_valid":        chain["chain_valid"],
        "chain_signed_count": chain["signed_count"],
        "chain_chained_count":chain["chained_count"],
        "chain_issues":       chain["issues"],
        "events":             result_rows,
    }

    if export:
        try:
            import json as _json
            from ledger_app.services.storage import upload_audit_export_async, _run_async
            auth = getattr(request.state, "auth_context", None)
            tenant_id = getattr(auth, "tenant_id", None) or "shared"
            payload = _json.dumps(response, default=str, sort_keys=True).encode()
            export_result = _run_async(
                upload_audit_export_async(tenant_id, case_id, payload)
            )
            response["export_uri"] = export_result.storage_uri
            response["export_sha256"] = export_result.sha256
        except Exception as exc:
            response["export_error"] = str(exc)

    return response
