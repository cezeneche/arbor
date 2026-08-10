"""
Audit log endpoint: retrieve and verify the signed CBAM audit trail per case.

GET /api/cases/{case_id}/audit-log
    Returns all audit events from cbam.audit_log for a CBAM case with per-row
    HMAC verification and full chain integrity status.

    - verified: true  — HMAC present and matches
    - verified: false — HMAC present but tampered
    - verified: null  — unsigned row (no signature stored)
    - chain_valid: true  — no tampering, and every gap is documented
    - chain_tampered: true — a row was altered, or rows are out of order
    - chain_gaps: rows missing from the sequence; an auditor needs these
      distinguished from tampering, because a gap can be a recorded
      administrative act and tampering never is

GET /api/cases/{case_id}/audit-log?export=true
    Additionally exports the audit log to S3 with GOVERNANCE Object Lock.
    Returns the storage_uri of the archive.

All events are stored in cbam.audit_log with columns:
    id, tenant_id, case_id, event_type, actor, payload, signature, chain_hash, created_at

The HMAC chain uses cbam.audit_log.signature (computed over event content +
chain_hash of the prior row) to make deletion or reordering detectable.
"""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import text

from ledger_app.api.cbam._shared import engine as _cbam_engine
from ledger_app.services.audit_signer import verify_chain, verify_event

log = logging.getLogger("nucleos.audit")

router = APIRouter(tags=["audit"])


def _to_signer_row(row: dict) -> dict:
    """Rename a cbam.audit_log row into the column names audit_signer reads.

        signature  → hmac_sha256
        chain_hash → prev_hmac
        actor      → actor_sub
        payload    → event_json

    The two schemas exist because the CBAM tables were built separately from the
    original audit_log. Renaming here keeps one implementation of the chain
    guarantee instead of two that can drift apart — and they had already drifted:
    only one of them could tell a documented gap from tampering.
    """
    return {
        "id":          row.get("id"),
        "case_id":     row.get("case_id"),
        "event_type":  row.get("event_type"),
        "actor_sub":   row.get("actor"),
        "event_json":  row.get("payload") or {},
        "hmac_sha256": row.get("signature"),
        "prev_hmac":   row.get("chain_hash"),
    }


def _verify_cbam_event(row: dict) -> bool | None:
    """
    Verify the HMAC signature of a cbam.audit_log row.

    Returns:
        True  — signature present and matches
        False — signature present but does NOT match (tampered)
        None  — no signature, or no signing key available to check it
    """
    if not os.getenv("AUDIT_SIGNING_KEY", "").strip():
        return None  # cannot verify without the signing key
    return verify_event(_to_signer_row(row))


def _verify_cbam_chain(rows: list[dict], documented_gaps: list[str] | None = None) -> dict:
    """
    Verify the hash chain across an ordered sequence of cbam.audit_log rows.

    Reports tampering and gaps separately: a chain with rows missing and a chain
    whose rows were altered are both invalid, but they mean different things to
    an auditor and only one of them is evidence of interference.
    """
    result = verify_chain([_to_signer_row(r) for r in rows], documented_gaps=documented_gaps)
    return {
        "chain_valid":     result.chain_valid,
        "tampered":        result.tampered,
        "gaps":            result.gaps,
        "signed_count":    result.signed_count,
        "chained_count":   result.chained_count,
        "broken_at_index": result.broken_at_index,
        "issues":          result.issues,
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
        "chain_tampered":     chain["tampered"],
        "chain_gaps":         chain["gaps"],
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
