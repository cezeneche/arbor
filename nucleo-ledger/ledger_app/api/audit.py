"""
Audit log endpoint: retrieve and verify signed audit trail entries per case.

GET /api/cases/{case_id}/audit-log
    Returns all audit events for a case with per-row HMAC verification status.
    - verified: true  — HMAC present and correct
    - verified: false — HMAC present but tampered
    - verified: null  — legacy row (no HMAC, created before signing was added)

GET /api/cases/{case_id}/audit-log?export=true
    Additionally exports the audit log to S3 with GOVERNANCE Object Lock.
    Returns the s3_uri of the archive.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import text

from ledger_app.db.session import engine
from ledger_app.services.audit_signer import export_to_s3_immutable, verify_event

router = APIRouter()


@router.get("/cases/{case_id}/audit-log")
def get_audit_log(
    request: Request,
    case_id: str,
    export: bool = Query(default=False, description="Export to S3 with Object Lock"),
):
    with engine.connect() as conn:
        # Verify the case exists
        exists = conn.execute(
            text("SELECT 1 FROM cases WHERE id = :id"),
            {"id": case_id},
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Case not found")

        rows = conn.execute(
            text("""
                SELECT id, case_id, event_type, actor_type, actor_sub,
                       event_json, hmac_sha256, created_at
                FROM audit_log
                WHERE case_id = :case_id
                ORDER BY created_at ASC
            """),
            {"case_id": case_id},
        ).mappings().all()

    result_rows = []
    for row in rows:
        r = dict(row)
        r["verified"] = verify_event(r)
        result_rows.append(r)

    response: dict = {
        "case_id": case_id,
        "count": len(result_rows),
        "events": result_rows,
    }

    if export:
        try:
            from ledger_app.services.storage import S3_BUCKET, get_s3_client
            s3 = get_s3_client()
            uri = export_to_s3_immutable(case_id, result_rows, s3, S3_BUCKET)
            response["export_uri"] = uri
        except Exception as exc:
            response["export_error"] = str(exc)

    return response
