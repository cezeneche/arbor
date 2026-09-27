"""
The review flag the narrative gate sets on a CBAM case.

The narrative service (api/app/services/narrative.py) calls flag_for_review /
clear_review_flag in-process after its deterministic validator runs. State lives
in cbam.cbam_cases.review_status, and each change is written to cbam.audit_log
so it joins the HMAC chain.

These were also HTTP endpoints, with reviewer approve/reject routes beside them,
from before Arbor owned review. Arbor never called them, and they were removed
on 27 September 2026 (docs/audits/2026-09-27-nucleos-endpoints.md).

    null -> pending_review            (flag)
    pending_review/rejected -> null   (clear, after a re-run passes)
    approved                          (terminal; flag and clear are no-ops)
"""
from __future__ import annotations

from fastapi import HTTPException
from shared_auth.models import AuthContext
from sqlalchemy import text

from ledger_app.api.cbam._shared import _write_audit_event
from ledger_app.api.cbam._shared import engine as _cbam_engine


def _get_case_review_status(conn, case_id: str) -> str | None:
    """Fetch review_status from cbam.cbam_cases. Raises 404 if not found."""
    row = conn.execute(
        text("SELECT review_status FROM cbam.cbam_cases WHERE id = :id LIMIT 1"),
        {"id": case_id},
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return row[0]


def flag_for_review(
    case_id: str,
    auth_context: AuthContext,
):
    """
    Set review_status = 'pending_review' on cbam.cbam_cases.

    Idempotent — safe to call multiple times. No-op if already 'approved'
    (approved is terminal and cannot be re-flagged).
    """
    with _cbam_engine.begin() as conn:
        current = _get_case_review_status(conn, case_id)
        if current == "approved":
            return  # terminal — do not re-flag
        if current == "pending_review":
            return  # already flagged — idempotent
        conn.execute(
            text("""
                UPDATE cbam.cbam_cases
                SET review_status = 'pending_review', updated_at = NOW()
                WHERE id = :id
            """),
            {"id": case_id},
        )
    _write_audit_event(
        case_id, "narrative_review_required",
        {"review_status": "pending_review"},
        actor_sub=auth_context.sub,
    )


def clear_review_flag(
    case_id: str,
    auth_context: AuthContext,
):
    """
    Clear review_status back to NULL after a successful pipeline re-run.

    Only clears 'pending_review' or 'rejected'. Never touches 'approved'.
    """
    with _cbam_engine.begin() as conn:
        current = _get_case_review_status(conn, case_id)
        if current not in ("pending_review", "rejected"):
            return  # nothing to clear (null or approved)
        conn.execute(
            text("""
                UPDATE cbam.cbam_cases
                SET review_status = NULL, updated_at = NOW()
                WHERE id = :id AND review_status IN ('pending_review', 'rejected')
            """),
            {"id": case_id},
        )
    _write_audit_event(
        case_id, "review_cleared",
        {"review_status": None, "reason": "pipeline_auto_cleared"},
        actor_sub=auth_context.sub,
    )
