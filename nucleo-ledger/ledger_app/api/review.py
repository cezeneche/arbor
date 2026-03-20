"""
Human review workflow for the narrative gate.

When the Gemini gate flags a narrative as requiring human review, the narrative
service calls POST /cases/{id}/review/flag to persist the pending state.
A reviewer then approves or rejects via the endpoints here. The bundle endpoint
checks review_status and blocks submission while 'pending_review'.

Endpoints:
    POST /cases/{case_id}/review/flag     — internal; called by narrative service
    POST /cases/{case_id}/review/clear    — internal; called after pipeline re-run passes
    POST /cases/{case_id}/review/approve  — reviewer action (review:write scope)
    POST /cases/{case_id}/review/reject   — reviewer action (review:write scope)
    GET  /cases/{case_id}/review          — status + signoff history (cbam:read scope)

State machine for review_status:
    null → pending_review (flag)
    pending_review → approved  (approve; terminal — cases.status → signed_off)
    pending_review → rejected  (reject)
    rejected → null            (clear, after pipeline re-run passes)
    rejected/pending_review → pending_review  (flag, after pipeline re-run fails)
    approved → approved        (terminal; flag and clear are no-ops)
"""
from __future__ import annotations

import json
import logging
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

log = logging.getLogger("nucleos.review")

from ledger_app.db.session import engine
from ledger_app.services.audit_signer import get_prev_chain_hmac, sign_event
from shared_auth.dependencies import require_scopes
from shared_auth.models import AuthContext

router = APIRouter()

_REVIEW_WRITABLE_STATES = frozenset({"pending_review", "rejected", None})


def _get_case_review_status(conn, case_id: str) -> str | None:
    """Fetch review_status for case_id. Raises 404 if not found."""
    row = conn.execute(
        text("SELECT review_status FROM cases WHERE id = :id"),
        {"id": case_id},
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return row[0]


def _write_review_audit(conn, case_id: str, event_type: str, actor_sub: str, payload: dict) -> None:
    """Append a signed+chained audit entry for a review state change."""
    event_str = json.dumps(payload, sort_keys=True)
    prev = get_prev_chain_hmac(case_id, conn)
    sig = sign_event(case_id, event_type, actor_sub, event_str, prev_hmac=prev)
    conn.execute(
        text("""
            INSERT INTO audit_log
                (case_id, event_type, actor_type, actor_sub, event_json, hmac_sha256, prev_hmac)
            VALUES
                (:case_id, :event_type, 'system', :sub,
                 CAST(:event AS jsonb), :sig, :prev)
        """),
        {
            "case_id": case_id,
            "event_type": event_type,
            "sub": actor_sub,
            "event": event_str,
            "sig": sig,
            "prev": prev,
        },
    )


# ── Internal endpoints (called by narrative service, scope: cbam:write) ────────

@router.post("/cases/{case_id}/review/flag", status_code=204)
def flag_for_review(
    case_id: str,
    auth_context: AuthContext = Depends(require_scopes(["cbam:write"])),
):
    """
    Set review_status = 'pending_review'.

    Idempotent — safe to call multiple times. No-op if already 'approved'
    (approved is terminal and cannot be re-flagged).
    """
    with engine.begin() as conn:
        current = _get_case_review_status(conn, case_id)
        if current == "approved":
            return  # terminal — do not re-flag
        if current == "pending_review":
            return  # already flagged — idempotent
        conn.execute(
            text("""
                UPDATE cases
                SET review_status = 'pending_review', updated_at = NOW()
                WHERE id = :id
            """),
            {"id": case_id},
        )
        _write_review_audit(
            conn, case_id, "narrative_review_required", auth_context.sub,
            {"review_status": "pending_review"},
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
    with engine.begin() as conn:
        current = _get_case_review_status(conn, case_id)
        if current not in ("pending_review", "rejected"):
            return  # nothing to clear (null or approved)
        conn.execute(
            text("""
                UPDATE cases
                SET review_status = NULL, updated_at = NOW()
                WHERE id = :id AND review_status IN ('pending_review', 'rejected')
            """),
            {"id": case_id},
        )
        _write_review_audit(
            conn, case_id, "review_cleared", auth_context.sub,
            {"review_status": None, "reason": "pipeline_auto_cleared"},
        )


# ── Notification helpers ─────────────────────────────────────────────────────────

def _fetch_cbam_case_notification_data(case_id: str) -> dict:
    """Best-effort: return CBAM case details needed for the approval email.

    Queries cbam.cbam_cases + cbam.cbam_registration using the CBAM engine.
    Returns an empty dict on any failure (e.g. not a CBAM case, SQLite test DB,
    missing schema).  All exceptions are swallowed — callers must handle {} gracefully.

    Returned keys (all optional / may be None):
        period        : "2027 Annual" or "Q1 2028"
        contact_email : importer contact email from business_address JSON
        tenant_name   : display name from cbam_registration or cbam_cases
    """
    try:
        from ledger_app.api.cbam._shared import engine as _cbam_engine

        with _cbam_engine.connect() as conn:
            row = conn.execute(
                text("""
                    SELECT
                        c.reporting_year,
                        c.reporting_quarter,
                        COALESCE(r.business_name, c.importer_name) AS tenant_name,
                        (r.business_address::jsonb)->>'email'       AS contact_email
                    FROM   cbam.cbam_cases c
                    LEFT JOIN cbam.cbam_registration r ON r.tenant_id = c.tenant_id
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
            # Callers with access to the computed HMRC return can pass the exact figure;
            # this endpoint uses a safe fallback — the full amount is in the report itself.
            total_liability_gbp_str="See your compliance report",
            base_url=os.getenv("BASE_URL", ""),
        )
    except Exception as exc:
        log.debug("_schedule_report_notification: failed (non-fatal): %s", exc)


# ── Reviewer endpoints (scope: review:write) ────────────────────────────────────

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

    - Inserts a signoff record (decision='approved')
    - Sets cases.review_status = 'approved'
    - Advances cases.status = 'signed_off'
    - Writes a signed audit log entry
    """
    with engine.begin() as conn:
        current = _get_case_review_status(conn, case_id)
        if current != "pending_review":
            raise HTTPException(
                status_code=409,
                detail=f"Case is not pending review (review_status={current!r}). "
                       "Only 'pending_review' cases can be approved.",
            )
        signoff = conn.execute(
            text("""
                INSERT INTO signoffs
                    (case_id, reviewer_name, reviewer_email, decision, comments, actor_sub)
                VALUES (:case_id, :name, :email, 'approved', :comments, :sub)
                RETURNING id, created_at
            """),
            {
                "case_id": case_id,
                "name": body.reviewer_name,
                "email": body.reviewer_email,
                "comments": body.comments,
                "sub": auth_context.sub,
            },
        ).mappings().one()
        conn.execute(
            text("""
                UPDATE cases
                SET review_status = 'approved', status = 'signed_off', updated_at = NOW()
                WHERE id = :id
            """),
            {"id": case_id},
        )
        _write_review_audit(
            conn, case_id, "case_approved", auth_context.sub,
            {
                "decision": "approved",
                "signoff_id": str(signoff["id"]),
                "reviewer_name": body.reviewer_name,
                "comments": body.comments,
            },
        )
    # Fire report-ready email after the HTTP response is returned (BackgroundTask)
    _schedule_report_notification(case_id, background_tasks)

    return {
        "case_id": case_id,
        "decision": "approved",
        "signoff_id": str(signoff["id"]),
    }


@router.post("/cases/{case_id}/review/reject", status_code=200)
def reject_case(
    case_id: str,
    body: ReviewDecisionBody,
    auth_context: AuthContext = Depends(require_scopes(["review:write"])),
):
    """
    Reject a case pending human review.

    - Inserts a signoff record (decision='rejected')
    - Sets cases.review_status = 'rejected'
    - Operator must correct data and re-run the narrative pipeline to re-submit.
    - Writes a signed audit log entry
    """
    with engine.begin() as conn:
        current = _get_case_review_status(conn, case_id)
        if current != "pending_review":
            raise HTTPException(
                status_code=409,
                detail=f"Case is not pending review (review_status={current!r}). "
                       "Only 'pending_review' cases can be rejected.",
            )
        signoff = conn.execute(
            text("""
                INSERT INTO signoffs
                    (case_id, reviewer_name, reviewer_email, decision, comments, actor_sub)
                VALUES (:case_id, :name, :email, 'rejected', :comments, :sub)
                RETURNING id, created_at
            """),
            {
                "case_id": case_id,
                "name": body.reviewer_name,
                "email": body.reviewer_email,
                "comments": body.comments,
                "sub": auth_context.sub,
            },
        ).mappings().one()
        conn.execute(
            text("""
                UPDATE cases
                SET review_status = 'rejected', updated_at = NOW()
                WHERE id = :id
            """),
            {"id": case_id},
        )
        _write_review_audit(
            conn, case_id, "case_rejected", auth_context.sub,
            {
                "decision": "rejected",
                "signoff_id": str(signoff["id"]),
                "reviewer_name": body.reviewer_name,
                "comments": body.comments,
            },
        )
    return {
        "case_id": case_id,
        "decision": "rejected",
        "signoff_id": str(signoff["id"]),
    }


# ── Read endpoint ───────────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/review")
def get_review_status(
    case_id: str,
    auth_context: AuthContext = Depends(require_scopes(["cbam:read"])),
):
    """
    Return the current review_status and full signoff history for a case.

    Response:
        {
          "case_id": "...",
          "review_status": "pending_review" | "approved" | "rejected" | null,
          "case_status": "...",
          "signoffs": [...]
        }
    """
    with engine.connect() as conn:
        case_row = conn.execute(
            text("SELECT review_status, status FROM cases WHERE id = :id"),
            {"id": case_id},
        ).fetchone()
        if case_row is None:
            raise HTTPException(status_code=404, detail="Case not found")
        signoffs = conn.execute(
            text("""
                SELECT id, reviewer_name, reviewer_email, decision, comments, actor_sub, created_at
                FROM signoffs
                WHERE case_id = :case_id
                ORDER BY created_at ASC
            """),
            {"case_id": case_id},
        ).mappings().all()
    return {
        "case_id": case_id,
        "review_status": case_row[0],
        "case_status": case_row[1],
        "signoffs": [dict(s) for s in signoffs],
    }
