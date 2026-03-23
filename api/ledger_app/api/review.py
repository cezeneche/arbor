"""
Human review workflow for the CBAM narrative gate.

The narrative pipeline (api/app/services/narrative.py) calls flag_for_review /
clear_review_flag directly in-process after the deterministic validator runs.
A reviewer then approves or rejects via the endpoints here.

All state is stored in cbam.cbam_cases.review_status.  Signoff records are
written as structured events to cbam.audit_log via _write_audit_event so they
participate in the HMAC audit chain without requiring a separate signoffs table.

Endpoints:
    POST /cases/{case_id}/review/flag     — internal; called by narrative pipeline
    POST /cases/{case_id}/review/clear    — internal; called after pipeline re-run passes
    POST /cases/{case_id}/review/approve  — reviewer action (review:write scope)
    POST /cases/{case_id}/review/reject   — reviewer action (review:write scope)
    GET  /cases/{case_id}/review          — status + signoff history (cbam:read scope)

State machine for review_status on cbam.cbam_cases:
    null → pending_review (flag)
    pending_review → approved  (approve; terminal — cbam_cases.status → signed_off)
    pending_review → rejected  (reject)
    rejected → null            (clear, after pipeline re-run passes)
    rejected/pending_review → pending_review  (flag, after pipeline re-run fails)
    approved → approved        (terminal; flag and clear are no-ops)
"""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

log = logging.getLogger("nucleos.review")

from ledger_app.api.cbam._shared import engine as _cbam_engine, _write_audit_event
from shared_auth.dependencies import require_scopes
from shared_auth.models import AuthContext

router = APIRouter(tags=["review"])


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_case_review_status(conn, case_id: str) -> str | None:
    """Fetch review_status from cbam.cbam_cases. Raises 404 if not found."""
    row = conn.execute(
        text("SELECT review_status FROM cbam.cbam_cases WHERE id = :id LIMIT 1"),
        {"id": case_id},
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return row[0]


# ── Notification helpers ──────────────────────────────────────────────────────

def _fetch_cbam_case_notification_data(case_id: str) -> dict:
    """Best-effort: return CBAM case details needed for the approval email.

    Queries cbam.cbam_cases + cbam.cbam_registration.
    Returns an empty dict on any failure.  All exceptions are swallowed.

    Returned keys (all optional / may be None):
        period        : "2027 Annual" or "Q1 2028"
        contact_email : importer contact email from business_address JSON
        tenant_name   : display name from cbam_registration or cbam_cases
    """
    try:
        with _cbam_engine.connect() as conn:
            row = conn.execute(
                text("""
                    SELECT
                        c.reporting_year,
                        c.reporting_quarter,
                        COALESCE(r.business_name, c.importer_name) AS tenant_name,
                        (r.business_address::jsonb)->>'email'       AS contact_email
                    FROM   cbam.cbam_cases c
                    LEFT JOIN cbam.cbam_registration r ON r.tenant_id = c.tenant_id::uuid
                    WHERE  c.id = :case_id
                    LIMIT  1
                """),
                {"case_id": case_id},
            ).mappings().first()

        if row is None:
            return {}

        year    = row["reporting_year"]
        quarter = row["reporting_quarter"]
        period  = f"Q{quarter} {year}" if quarter else f"{year} Annual"

        return {
            "period":        period,
            "contact_email": row.get("contact_email"),
            "tenant_name":   row.get("tenant_name"),
        }
    except Exception as exc:
        log.debug("_fetch_cbam_case_notification_data: %s — skipping email notification", exc)
        return {}


def _schedule_report_notification(case_id: str, background_tasks: BackgroundTasks) -> None:
    """Register the approval email notification as a BackgroundTask (post-response).

    Uses a lazy import of app.services.notifications so that this module remains
    functional when run in ledger-only test contexts where the app package is absent.
    All failures are swallowed — the approval response is never affected.
    """
    try:
        from app.services.notifications import notify_report_ready  # lazy — consolidated service only

        data = _fetch_cbam_case_notification_data(case_id)
        if not data:
            log.debug("_schedule_report_notification: no CBAM data for case=%s — skipping", case_id)
            return

        background_tasks.add_task(
            notify_report_ready,
            case_id=case_id,
            recipient_email=data.get("contact_email"),
            period=data.get("period", ""),
            total_liability_gbp_str="See your compliance report",
            base_url=os.getenv("BASE_URL", ""),
        )
    except Exception as exc:
        log.debug("_schedule_report_notification: failed (non-fatal): %s", exc)


# ── Internal endpoints (called by narrative pipeline, scope: cbam:write) ──────

@router.post("/cases/{case_id}/review/flag", status_code=204)
def flag_for_review(
    case_id: str,
    auth_context: AuthContext = Depends(require_scopes(["cbam:write"])),
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


@router.post("/cases/{case_id}/review/clear", status_code=204)
def clear_review_flag(
    case_id: str,
    auth_context: AuthContext = Depends(require_scopes(["cbam:write"])),
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


# ── Reviewer endpoints (scope: review:write) ──────────────────────────────────

class ReviewDecisionBody(BaseModel):
    reviewer_name: str
    reviewer_email: str | None = None
    comments: str | None = None


@router.post("/cases/{case_id}/review/approve", status_code=200)
def approve_case(
    case_id: str,
    body: ReviewDecisionBody,
    background_tasks: BackgroundTasks,
    auth_context: AuthContext = Depends(require_scopes(["review:write"])),
):
    """
    Approve a case pending human review.

    - Sets cbam_cases.review_status = 'approved'
    - Sets cbam_cases.status = 'signed_off'
    - Writes a signed signoff event to cbam.audit_log
    """
    with _cbam_engine.begin() as conn:
        current = _get_case_review_status(conn, case_id)
        if current != "pending_review":
            raise HTTPException(
                status_code=409,
                detail=f"Case is not pending review (review_status={current!r}). "
                       "Only 'pending_review' cases can be approved.",
            )
        conn.execute(
            text("""
                UPDATE cbam.cbam_cases
                SET review_status = 'approved', status = 'approved', updated_at = NOW()
                WHERE id = :id
            """),
            {"id": case_id},
        )

    _write_audit_event(
        case_id, "case_approved",
        {
            "decision": "approved",
            "reviewer_name": body.reviewer_name,
            "reviewer_email": body.reviewer_email,
            "comments": body.comments,
            "actor_sub": auth_context.sub,
        },
        actor_sub=auth_context.sub,
    )

    _schedule_report_notification(case_id, background_tasks)

    return {"case_id": case_id, "decision": "approved"}


@router.post("/cases/{case_id}/review/reject", status_code=200)
def reject_case(
    case_id: str,
    body: ReviewDecisionBody,
    auth_context: AuthContext = Depends(require_scopes(["review:write"])),
):
    """
    Reject a case pending human review.

    - Sets cbam_cases.review_status = 'rejected'
    - Writes a signed rejection event to cbam.audit_log
    - Operator must correct data and re-run the narrative pipeline to re-submit.
    """
    with _cbam_engine.begin() as conn:
        current = _get_case_review_status(conn, case_id)
        if current != "pending_review":
            raise HTTPException(
                status_code=409,
                detail=f"Case is not pending review (review_status={current!r}). "
                       "Only 'pending_review' cases can be rejected.",
            )
        conn.execute(
            text("""
                UPDATE cbam.cbam_cases
                SET review_status = 'rejected', updated_at = NOW()
                WHERE id = :id
            """),
            {"id": case_id},
        )

    _write_audit_event(
        case_id, "case_rejected",
        {
            "decision": "rejected",
            "reviewer_name": body.reviewer_name,
            "reviewer_email": body.reviewer_email,
            "comments": body.comments,
            "actor_sub": auth_context.sub,
        },
        actor_sub=auth_context.sub,
    )

    return {"case_id": case_id, "decision": "rejected"}


# ── Read endpoint ─────────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/review")
def get_review_status(
    case_id: str,
    auth_context: AuthContext = Depends(require_scopes(["cbam:read"])),
):
    """
    Return the current review_status and signoff history for a CBAM case.

    Signoffs are sourced from cbam.audit_log events of type 'case_approved'
    and 'case_rejected' — no separate signoffs table is required.

    Response:
        {
          "case_id": "...",
          "review_status": "pending_review" | "approved" | "rejected" | null,
          "case_status": "...",
          "signoffs": [...]
        }
    """
    with _cbam_engine.connect() as conn:
        case_row = conn.execute(
            text("SELECT review_status, status FROM cbam.cbam_cases WHERE id = :id LIMIT 1"),
            {"id": case_id},
        ).fetchone()
        if case_row is None:
            raise HTTPException(status_code=404, detail="Case not found")

        # Reconstruct signoff history from audit log events
        signoff_rows = conn.execute(
            text("""
                SELECT event_type, actor, payload, created_at
                FROM cbam.audit_log
                WHERE case_id = :case_id
                  AND event_type IN ('case_approved', 'case_rejected')
                ORDER BY created_at ASC
            """),
            {"case_id": case_id},
        ).mappings().all()

    signoffs = [
        {
            "decision":       r["event_type"].replace("case_", ""),
            "reviewer_name":  (r["payload"] or {}).get("reviewer_name"),
            "reviewer_email": (r["payload"] or {}).get("reviewer_email"),
            "comments":       (r["payload"] or {}).get("comments"),
            "actor_sub":      r["actor"],
            "created_at":     r["created_at"],
        }
        for r in signoff_rows
    ]

    return {
        "case_id":       case_id,
        "review_status": case_row[0],
        "case_status":   case_row[1],
        "signoffs":      signoffs,
    }
