"""CBAM Registration Management API — UK CBAM (Finance No.2 Bill 2025-26).

Route prefix: /api/cbam/registration  (registered in main.py with prefix="/api")

Endpoints
---------
GET  /cbam/registration/status
    Rolling 12-month threshold check + registration checklist + readiness score.

PUT  /cbam/registration
    Create or update the tenant's registration checklist (patch semantics).

GET  /cbam/registration/alerts
    List threshold alerts for the tenant.  ?include_acknowledged=true shows all.

POST /cbam/registration/alerts/{alert_id}/acknowledge
    Dismiss an alert from the dashboard action panel.

Auth: all endpoints require Bearer JWT (applied at router level in main.py).
Mutations require the ``cbam:write`` scope.

Regulatory basis: Finance No.2 Bill 2025-26, HMRC secondary legislation.
First registration deadline: 31 January 2028 (Year 1 annual filers).
"""

from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import text

from app.services.registration_manager import (
    RegistrationChecklist,
    RegistrationUpsert,
    ThresholdStatus,
    check_registration_threshold,
    compute_readiness_score,
    get_registration_checklist,
    upsert_registration,
)
from ledger_app.api.cbam._shared import engine
from shared_auth.dependencies import require_scopes
from shared_auth.models import AuthContext

_log = logging.getLogger("nucleos.registration")

router = APIRouter(prefix="/cbam/registration", tags=["registration"])


# ── Helpers ─────────────────────────────────────────────────────────────────────

def _tenant_id(request: Request) -> str:
    return getattr(getattr(request.state, "auth_context", None), "tenant_id", "") or ""


def _require_write(
    auth: AuthContext = Depends(require_scopes(["cbam:write"])),
) -> AuthContext:
    return auth


def _resolved_tenant(request: Request) -> UUID:
    tid = _tenant_id(request)
    if not tid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tenant ID is required.",
        )
    try:
        return UUID(tid)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tenant ID {tid!r} is not a valid UUID.",
        )


def _readiness_label(score: int, registration_status: str) -> str:
    """Human-readable label for the 0–100 readiness score."""
    if registration_status == "confirmed":
        return "Confirmed"
    if registration_status == "submitted":
        return "Submitted to HMRC"
    if score == 0:
        return "Not started"
    if score < 50:
        return "In progress"
    if score < 85:
        return "Nearly ready"
    return "Ready to submit"


def _threshold_status_dict(ts: ThresholdStatus) -> dict:
    """Serialise ThresholdStatus to a plain dict (Decimal → str for JSON safety)."""
    return {
        "status": ts.status,
        "rolling_12m_value_gbp": str(ts.rolling_12m_value_gbp),
        "threshold_gbp": str(ts.threshold_gbp),
        "approaching_threshold_gbp": str(ts.approaching_threshold_gbp),
        "percentage_of_threshold": str(ts.percentage_of_threshold),
        "days_until_registration_required": ts.days_until_registration_required,
        "action_required": ts.action_required,
        "as_of_date": ts.as_of_date.isoformat(),
    }


# ── Response models ──────────────────────────────────────────────────────────────

class RegistrationStatusResponse(BaseModel):
    """Response for GET /cbam/registration/status."""

    threshold_status: dict
    checklist: RegistrationChecklist
    readiness_score: int      # 0–100
    readiness_label: str      # "Not started" | "In progress" | … | "Confirmed"


# ── Endpoints ────────────────────────────────────────────────────────────────────

@router.get(
    "/status",
    response_model=RegistrationStatusResponse,
    summary="Registration threshold status and checklist",
)
def get_registration_status(request: Request) -> RegistrationStatusResponse:
    """Return the current registration threshold status, HMRC checklist, and
    readiness score for the authenticated tenant.

    The **readiness score** (0–100) reflects how complete the Government Gateway
    registration checklist is, weighted by field importance:

    | Field                              | Points |
    |------------------------------------|--------|
    | EORI number                        | 25     |
    | VAT registration number            | 20     |
    | Business legal name                | 20     |
    | Business address                   | 15     |
    | Estimated import value (£)         |  5     |
    | Estimated import weight (kg)       |  5     |
    | Registration in progress           |  5     |
    | HMRC reference received            |  5     |

    The **threshold_status** reflects the rolling 12-month CBAM goods import
    value against the £50,000 statutory registration threshold.
    """
    tenant_id = _resolved_tenant(request)
    today = date.today()

    threshold = check_registration_threshold(tenant_id, today, engine)
    checklist = get_registration_checklist(tenant_id, engine)
    score = compute_readiness_score(checklist)

    return RegistrationStatusResponse(
        threshold_status=_threshold_status_dict(threshold),
        checklist=checklist,
        readiness_score=score,
        readiness_label=_readiness_label(score, checklist.registration_status),
    )


@router.put(
    "",
    status_code=status.HTTP_200_OK,
    summary="Create or update registration checklist",
    dependencies=[Depends(_require_write)],
)
def update_registration(request: Request, body: RegistrationUpsert) -> dict:
    """Create or update the tenant's CBAM registration checklist.

    Patch semantics: only fields explicitly provided (non-None) are written.
    The full updated checklist and readiness score are returned.

    **Lifecycle transitions** (set via `registration_status`):

    - `not_started` → `in_progress`  when the importer begins gathering documents
    - `in_progress`  → `submitted`    after submitting via Government Gateway
    - `submitted`    → `confirmed`    once HMRC confirms (supply `registration_reference`)

    Setting `registration_status = confirmed` without a `registration_reference`
    is accepted but will not award the "HMRC reference received" readiness points
    until the reference is also supplied.
    """
    tenant_id = _resolved_tenant(request)
    updated = upsert_registration(tenant_id, body, engine)
    score = compute_readiness_score(updated)

    _log.info(
        "registration_updated: tenant=%s status=%s score=%d",
        tenant_id, updated.registration_status, score,
    )

    return {
        "checklist": updated.model_dump(mode="json"),
        "readiness_score": score,
        "readiness_label": _readiness_label(score, updated.registration_status),
    }


@router.get(
    "/alerts",
    summary="List threshold alerts",
)
def list_threshold_alerts(
    request: Request,
    include_acknowledged: bool = False,
) -> dict:
    """List registration threshold alerts for the authenticated tenant.

    By default returns only **unacknowledged** alerts (dashboard action panel).
    Pass `?include_acknowledged=true` to include acknowledged (historical) alerts.

    Alerts are generated automatically by the APScheduler monthly job on the
    first of each month.  Up to 50 most-recent alerts are returned.
    """
    tenant_id = _resolved_tenant(request)
    ack_filter = "" if include_acknowledged else "AND acknowledged_at IS NULL"

    with engine.connect() as conn:
        rows = conn.execute(
            text(f"""
                SELECT id,
                       alert_type,
                       rolling_value_gbp,
                       triggered_at,
                       acknowledged_at,
                       message
                FROM   cbam.cbam_threshold_alerts
                WHERE  tenant_id = :tenant_id
                {ack_filter}
                ORDER  BY triggered_at DESC
                LIMIT  50
            """),
            {"tenant_id": str(tenant_id)},
        ).mappings().all()

    alerts = [
        {
            "id": str(r["id"]),
            "alert_type": r["alert_type"],
            "rolling_value_gbp": (
                str(r["rolling_value_gbp"]) if r["rolling_value_gbp"] is not None else None
            ),
            "triggered_at": (
                r["triggered_at"].isoformat() if r["triggered_at"] else None
            ),
            "acknowledged_at": (
                r["acknowledged_at"].isoformat() if r["acknowledged_at"] else None
            ),
            "message": r["message"],
        }
        for r in rows
    ]

    return {
        "alerts": alerts,
        "count": len(alerts),
        "includes_acknowledged": include_acknowledged,
    }


@router.post(
    "/alerts/{alert_id}/acknowledge",
    status_code=status.HTTP_200_OK,
    summary="Acknowledge a threshold alert",
    dependencies=[Depends(_require_write)],
)
def acknowledge_alert(request: Request, alert_id: UUID) -> dict:
    """Mark a threshold alert as acknowledged.

    Acknowledged alerts no longer appear in the default dashboard action panel
    (they are hidden unless `?include_acknowledged=true` is passed to
    `GET /alerts`).

    Returns 404 if the alert is not found, does not belong to the tenant,
    or has already been acknowledged.
    """
    tenant_id = _resolved_tenant(request)

    with engine.begin() as conn:
        result = conn.execute(
            text("""
                UPDATE cbam.cbam_threshold_alerts
                SET    acknowledged_at = NOW()
                WHERE  id              = :alert_id
                  AND  tenant_id       = :tenant_id
                  AND  acknowledged_at IS NULL
                RETURNING id, alert_type
            """),
            {"alert_id": str(alert_id), "tenant_id": str(tenant_id)},
        ).mappings().all()

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Alert {alert_id!s} not found, does not belong to this tenant, "
                "or has already been acknowledged."
            ),
        )

    row = dict(result[0])
    _log.info(
        "threshold_alert_acknowledged: tenant=%s alert_id=%s type=%s",
        tenant_id, alert_id, row.get("alert_type"),
    )

    return {
        "acknowledged": True,
        "alert_id": str(alert_id),
        "alert_type": row.get("alert_type"),
    }
