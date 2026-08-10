"""CBAM Registration Management — UK CBAM (Finance No.2 Bill 2025-26).

This module implements the rolling 12-month import-value threshold check and
the HMRC Government Gateway registration checklist workflow.

Public API
----------
ThresholdStatus            dataclass — result of a threshold check
RegistrationChecklist      Pydantic model — mirrors cbam_registration row
RegistrationUpsert         Pydantic model — input for create/update

check_registration_threshold(tenant_id, as_of_date, db) -> ThresholdStatus
get_registration_checklist(tenant_id, db) -> RegistrationChecklist
upsert_registration(tenant_id, data, db) -> RegistrationChecklist
compute_readiness_score(checklist) -> int
record_threshold_alert(tenant_id, alert_type, rolling_value_gbp, message, db)
run_monthly_threshold_check(db) -> dict[str, int]

Regulatory basis
----------------
UK CBAM Finance No.2 Bill 2025-26:
  - Importers must register with HMRC if rolling 12-month CBAM goods value
    reaches £50,000 (the threshold).
  - "Approaching" = within 20 % of threshold (>= £40,000).
  - The 12-month window starts 1 January 2027 and rolls monthly thereafter.
  - On the first of each month importers must check their rolling value AND
    whether they expect to exceed £50,000 in the next 30 days.
  - First registration deadline: 31 January 2028 (Year 1 annual filers).
  - From February 2028: register by the first day of the month after breach.
  - Registration is via Government Gateway; requires EORI, VAT, business details.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

from dateutil.relativedelta import relativedelta
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.engine import Engine

_log = logging.getLogger("nucleos.registration")

# ── Regulatory constants ────────────────────────────────────────────────────────

_THRESHOLD_GBP: Decimal = Decimal("50000.00")
_APPROACHING_GBP: Decimal = Decimal("40000.00")  # 80 % of threshold
_YEAR_1_DEADLINE: date = date(2028, 1, 31)        # first annual-filer deadline


# ── Domain types ────────────────────────────────────────────────────────────────

@dataclass
class ThresholdStatus:
    """Result of the rolling 12-month import-value assessment.

    Fields
    ------
    status
        "below_threshold" — rolling value < £40,000; no action required.
        "approaching"     — rolling value £40,000–£49,999.99; prepare to register.
        "threshold_met"   — rolling value >= £50,000; registration required.
        "registered"      — tenant has confirmed HMRC registration.
    rolling_12m_value_gbp
        Sum of cbam_shipments.customs_value_gbp over the previous 12 months.
    threshold_gbp
        £50,000 (statutory threshold — fixed).
    approaching_threshold_gbp
        £40,000 (80 % of threshold — fixed).
    days_until_registration_required
        Calendar days until the applicable HMRC registration deadline.
        None when status is "below_threshold" or "registered".
    action_required
        Human-readable next-step description for the dashboard.
    as_of_date
        The date the check was performed.
    percentage_of_threshold
        rolling_12m_value_gbp / threshold_gbp × 100, rounded to 1 dp.
    """

    status: str
    rolling_12m_value_gbp: Decimal
    days_until_registration_required: int | None
    action_required: str
    as_of_date: date
    percentage_of_threshold: Decimal
    # Constants — excluded from __init__ (set automatically after construction)
    threshold_gbp: Decimal = field(default=_THRESHOLD_GBP, init=False, repr=False)
    approaching_threshold_gbp: Decimal = field(default=_APPROACHING_GBP, init=False, repr=False)


class RegistrationChecklist(BaseModel):
    """Mirrors the cbam_registration DB row with UI-friendly field names.

    All fields are optional — the row may be partially filled as the importer
    works through the Government Gateway registration checklist.
    """

    eori_number: str | None = None
    vat_registration_number: str | None = None
    business_legal_name: str | None = None
    business_address: dict | None = None
    cbam_goods_import_value_estimate_gbp: Decimal | None = None
    cbam_goods_weight_estimate_kg: Decimal | None = None
    registration_status: str = "not_started"
    registration_reference: str | None = None
    registered_at: date | None = None


class RegistrationUpsert(BaseModel):
    """Input model for creating or updating a registration record.

    Patch semantics: only fields explicitly provided (non-None) are written.
    """

    eori_number: str | None = Field(None, max_length=20)
    vat_registration_number: str | None = Field(None, max_length=20)
    business_legal_name: str | None = Field(None, max_length=200)
    business_address: dict | None = None
    cbam_goods_import_value_estimate_gbp: Decimal | None = None
    cbam_goods_weight_estimate_kg: Decimal | None = None
    registration_status: str | None = Field(
        None,
        pattern=r"^(not_started|in_progress|submitted|confirmed)$",
    )
    registration_reference: str | None = Field(None, max_length=50)
    registered_at: date | None = None


# ── Deadline helper ─────────────────────────────────────────────────────────────

def _next_registration_deadline(as_of_date: date) -> date:
    """Return the applicable HMRC CBAM registration deadline.

    Year 1 (any date up to and including 31 Jan 2028):
        31 January 2028 — statutory first annual-filer deadline.

    From 1 February 2028 (rolling monthly):
        First day of the month following the threshold breach.
    """
    if as_of_date <= _YEAR_1_DEADLINE:
        return _YEAR_1_DEADLINE
    # Rolling: register by the first of the next calendar month
    return as_of_date.replace(day=1) + relativedelta(months=1)


# ── Rolling value query ─────────────────────────────────────────────────────────

def _query_rolling_value(
    conn: Any,
    tenant_id: UUID,
    window_start: date,
    as_of_date: date,
) -> Decimal:
    """Sum customs_value_gbp from cbam_shipments for the rolling 12-month window.

    Joins through cbam_cases for tenant isolation.  Returns Decimal("0.00") if
    the customs_value_gbp column is not yet present (pre-migration DBs) or if
    no rows match.
    """
    try:
        row = conn.execute(
            text("""
                SELECT COALESCE(SUM(s.customs_value_gbp), 0) AS total
                FROM   cbam.cbam_shipments s
                JOIN   cbam.cbam_cases     c ON s.case_id = c.id
                WHERE  c.tenant_id          = :tenant_id
                  AND  s.import_date       >= :window_start
                  AND  s.import_date       <= :as_of_date
                  AND  s.customs_value_gbp  IS NOT NULL
            """),
            {
                "tenant_id": str(tenant_id),
                "window_start": window_start,
                "as_of_date": as_of_date,
            },
        ).mappings().first()
        return Decimal(str(row["total"] or 0)).quantize(Decimal("0.01"))
    except Exception as exc:  # noqa: BLE001
        _log.warning(
            "rolling_value_query_failed: tenant=%s err=%s — returning 0",
            tenant_id, exc,
        )
        return Decimal("0.00")


# ── Core service functions ──────────────────────────────────────────────────────

def check_registration_threshold(
    tenant_id: UUID,
    as_of_date: date,
    db: Engine,
) -> ThresholdStatus:
    """Check whether a tenant has crossed or is approaching the £50,000
    registration threshold over the previous rolling 12 months.

    The rolling window runs from (as_of_date − 12 months) to as_of_date
    inclusive.  Only shipments with a non-NULL customs_value_gbp contribute.

    Returns ThresholdStatus where status is one of:
        "registered"      — tenant already has a confirmed HMRC registration.
        "threshold_met"   — rolling value >= £50,000; registration required.
        "approaching"     — rolling value >= £40,000; preparation advised.
        "below_threshold" — rolling value < £40,000; no action required.
    """
    window_start = as_of_date - relativedelta(months=12)

    with db.connect() as conn:
        # ── Check if already registered (status = confirmed) ──────────────────
        reg_row = conn.execute(
            text("""
                SELECT registration_status, registration_reference
                FROM   cbam.cbam_registration
                WHERE  tenant_id = :tenant_id
                LIMIT  1
            """),
            {"tenant_id": str(tenant_id)},
        ).mappings().first()

        already_registered = (
            reg_row is not None
            and reg_row["registration_status"] == "confirmed"
        )

        rolling_value = _query_rolling_value(conn, tenant_id, window_start, as_of_date)

    pct = (
        (rolling_value / _THRESHOLD_GBP * 100)
        .quantize(Decimal("0.1"))
    )

    if already_registered:
        ref = (reg_row["registration_reference"] or "pending") if reg_row else "pending"
        return ThresholdStatus(
            status="registered",
            rolling_12m_value_gbp=rolling_value,
            days_until_registration_required=None,
            action_required=(
                f"You are registered with HMRC (ref: {ref}). "
                "Maintain records for 6 years and update your registration "
                "if your EORI, VAT number, or business details change."
            ),
            as_of_date=as_of_date,
            percentage_of_threshold=pct,
        )

    deadline = _next_registration_deadline(as_of_date)
    days_remaining = max(0, (deadline - as_of_date).days)

    if rolling_value >= _THRESHOLD_GBP:
        overdue = days_remaining == 0
        urgency = "OVERDUE — " if overdue else f"Register by {deadline:%d %B %Y}. "
        return ThresholdStatus(
            status="threshold_met",
            rolling_12m_value_gbp=rolling_value,
            days_until_registration_required=days_remaining,
            action_required=(
                f"{urgency}"
                f"Your rolling 12-month CBAM import value is £{rolling_value:,.2f}, "
                f"exceeding the £50,000 registration threshold. "
                "Register via Government Gateway with your EORI number, "
                "VAT registration, and business details."
            ),
            as_of_date=as_of_date,
            percentage_of_threshold=pct,
        )

    if rolling_value >= _APPROACHING_GBP:
        remaining = _THRESHOLD_GBP - rolling_value
        return ThresholdStatus(
            status="approaching",
            rolling_12m_value_gbp=rolling_value,
            days_until_registration_required=days_remaining,
            action_required=(
                f"Your rolling 12-month CBAM import value is £{rolling_value:,.2f} "
                f"(£{remaining:,.2f} below the £50,000 threshold). "
                "Prepare your EORI number, VAT registration, and business details "
                f"now so you can register quickly if you cross the threshold "
                f"before {deadline:%d %B %Y}."
            ),
            as_of_date=as_of_date,
            percentage_of_threshold=pct,
        )

    remaining = _THRESHOLD_GBP - rolling_value
    return ThresholdStatus(
        status="below_threshold",
        rolling_12m_value_gbp=rolling_value,
        days_until_registration_required=None,
        action_required=(
            f"Your rolling 12-month CBAM import value is £{rolling_value:,.2f} "
            f"(£{remaining:,.2f} below the £50,000 threshold). "
            "No registration action is required at this time. "
            "Check again on the first of each month."
        ),
        as_of_date=as_of_date,
        percentage_of_threshold=pct,
    )


def get_registration_checklist(tenant_id: UUID, db: Engine) -> RegistrationChecklist:
    """Fetch the tenant's cbam_registration row.

    Returns a default (all-None, status='not_started') RegistrationChecklist
    if the tenant has no row yet.
    """
    with db.connect() as conn:
        row = conn.execute(
            text("""
                SELECT eori_number,
                       vat_number,
                       business_name,
                       business_address,
                       cbam_goods_import_value_estimate_gbp,
                       cbam_goods_weight_estimate_kg,
                       registration_status,
                       registration_reference,
                       registered_at
                FROM   cbam.cbam_registration
                WHERE  tenant_id = :tenant_id
                LIMIT  1
            """),
            {"tenant_id": str(tenant_id)},
        ).mappings().first()

    if not row:
        return RegistrationChecklist()

    return RegistrationChecklist(
        eori_number=row["eori_number"],
        vat_registration_number=row["vat_number"],
        business_legal_name=row["business_name"],
        business_address=dict(row["business_address"]) if row["business_address"] else None,
        cbam_goods_import_value_estimate_gbp=row["cbam_goods_import_value_estimate_gbp"],
        cbam_goods_weight_estimate_kg=row["cbam_goods_weight_estimate_kg"],
        registration_status=row["registration_status"] or "not_started",
        registration_reference=row["registration_reference"],
        registered_at=row["registered_at"],
    )


def upsert_registration(
    tenant_id: UUID,
    data: RegistrationUpsert,
    db: Engine,
) -> RegistrationChecklist:
    """Create or update the tenant's cbam_registration record.

    Patch semantics: only fields that are not None in *data* are written to
    the DB.  The ON CONFLICT … DO UPDATE clause ensures idempotency.
    """
    # Map Pydantic field names → DB column names
    db_fields: dict[str, Any] = {}
    if data.eori_number is not None:
        db_fields["eori_number"] = data.eori_number
    if data.vat_registration_number is not None:
        db_fields["vat_number"] = data.vat_registration_number
    if data.business_legal_name is not None:
        db_fields["business_name"] = data.business_legal_name
    if data.business_address is not None:
        db_fields["business_address"] = json.dumps(data.business_address)
    if data.cbam_goods_import_value_estimate_gbp is not None:
        db_fields["cbam_goods_import_value_estimate_gbp"] = str(
            data.cbam_goods_import_value_estimate_gbp
        )
    if data.cbam_goods_weight_estimate_kg is not None:
        db_fields["cbam_goods_weight_estimate_kg"] = str(data.cbam_goods_weight_estimate_kg)
    if data.registration_status is not None:
        db_fields["registration_status"] = data.registration_status
    if data.registration_reference is not None:
        db_fields["registration_reference"] = data.registration_reference
    if data.registered_at is not None:
        db_fields["registered_at"] = data.registered_at

    with db.begin() as conn:
        if db_fields:
            col_list = ", ".join(db_fields.keys())
            val_list = ", ".join(f":{k}" for k in db_fields.keys())
            set_clause = ", ".join(f"{k} = :{k}" for k in db_fields.keys())
            conn.execute(
                text(f"""
                    INSERT INTO cbam.cbam_registration (tenant_id, {col_list})
                    VALUES (:tenant_id, {val_list})
                    ON CONFLICT (tenant_id) DO UPDATE
                    SET {set_clause}, updated_at = NOW()
                """),
                {"tenant_id": str(tenant_id), **db_fields},
            )
        else:
            # Touch the row into existence without modifying any fields
            conn.execute(
                text("""
                    INSERT INTO cbam.cbam_registration (tenant_id)
                    VALUES (:tenant_id)
                    ON CONFLICT (tenant_id) DO NOTHING
                """),
                {"tenant_id": str(tenant_id)},
            )

    return get_registration_checklist(tenant_id, db)


def compute_readiness_score(checklist: RegistrationChecklist) -> int:
    """Return a 0–100 readiness score based on checklist completeness.

    Scoring weights reflect HMRC mandatory vs. advisory fields:

        eori_number                              25 pts  (mandatory — identity)
        vat_registration_number                  20 pts  (mandatory — tax link)
        business_legal_name                      20 pts  (mandatory — entity)
        business_address                         15 pts  (mandatory — registered address)
        cbam_goods_import_value_estimate_gbp      5 pts  (HMRC form advisory)
        cbam_goods_weight_estimate_kg             5 pts  (HMRC form advisory)
        registration_status != 'not_started'      5 pts  (registration in progress)
        registration_reference provided           5 pts  (submission confirmed)
                                                -----
                                                100 pts
    """
    score = 0
    if checklist.eori_number:
        score += 25
    if checklist.vat_registration_number:
        score += 20
    if checklist.business_legal_name:
        score += 20
    if checklist.business_address:
        score += 15
    if checklist.cbam_goods_import_value_estimate_gbp is not None:
        score += 5
    if checklist.cbam_goods_weight_estimate_kg is not None:
        score += 5
    if checklist.registration_status != "not_started":
        score += 5
    if checklist.registration_reference:
        score += 5
    return score


def record_threshold_alert(
    tenant_id: UUID,
    alert_type: str,
    rolling_value_gbp: Decimal,
    message: str,
    db: Engine,
) -> None:
    """Persist a cbam_threshold_alerts row.

    Deduplication: if an unacknowledged alert of the same *alert_type* was
    already recorded for this tenant within the last 25 days, the insert is
    skipped.  This prevents duplicate alerts when the scheduler runs twice
    near a month boundary.
    """
    with db.begin() as conn:
        existing = conn.execute(
            text("""
                SELECT id
                FROM   cbam.cbam_threshold_alerts
                WHERE  tenant_id     = :tenant_id
                  AND  alert_type    = :alert_type
                  AND  acknowledged_at IS NULL
                  AND  triggered_at >= NOW() - INTERVAL '25 days'
                LIMIT  1
            """),
            {"tenant_id": str(tenant_id), "alert_type": alert_type},
        ).first()

        if existing:
            _log.debug(
                "threshold_alert_dedup: tenant=%s type=%s — skipped",
                tenant_id, alert_type,
            )
            return

        conn.execute(
            text("""
                INSERT INTO cbam.cbam_threshold_alerts
                    (tenant_id, alert_type, rolling_value_gbp, message)
                VALUES
                    (:tenant_id, :alert_type, :rolling_value_gbp, :message)
            """),
            {
                "tenant_id": str(tenant_id),
                "alert_type": alert_type,
                "rolling_value_gbp": str(rolling_value_gbp),
                "message": message,
            },
        )
        _log.info(
            "threshold_alert_recorded: tenant=%s type=%s value=£%.2f",
            tenant_id, alert_type, rolling_value_gbp,
        )


def run_monthly_threshold_check(db: Engine) -> dict[str, int]:
    """Scheduler entry point — runs on the 1st of each month at 01:00 UTC.

    Iterates all known tenants (union of cbam_registration and cbam_cases
    tenant_id columns) and calls check_registration_threshold for each.
    Records a cbam_threshold_alerts row when status is 'approaching' or
    'threshold_met'.

    Returns a summary dict:
        {"total": int, "approaching": int, "threshold_met": int, "errors": int}
    """
    today = date.today()
    _log.info("monthly_threshold_check: started as_of=%s", today)

    summary: dict[str, int] = {
        "total": 0,
        "approaching": 0,
        "threshold_met": 0,
        "errors": 0,
    }

    # Collect all tenant IDs from registration table + cases table
    try:
        with db.connect() as conn:
            rows = conn.execute(
                text("""
                    SELECT DISTINCT tenant_id
                    FROM (
                        SELECT tenant_id FROM cbam.cbam_registration
                        UNION
                        SELECT tenant_id
                        FROM   cbam.cbam_cases
                        WHERE  tenant_id IS NOT NULL
                    ) t
                    WHERE tenant_id IS NOT NULL
                """)
            ).fetchall()
        tenant_ids = [UUID(str(r[0])) for r in rows]
    except Exception as exc:  # noqa: BLE001
        _log.error("monthly_threshold_check: tenant_query_failed: %s", exc)
        return summary

    _log.info("monthly_threshold_check: checking %d tenants", len(tenant_ids))

    for tenant_id in tenant_ids:
        summary["total"] += 1
        try:
            ts = check_registration_threshold(tenant_id, today, db)

            if ts.status == "threshold_met":
                summary["threshold_met"] += 1
                record_threshold_alert(
                    tenant_id=tenant_id,
                    alert_type="threshold_met",
                    rolling_value_gbp=ts.rolling_12m_value_gbp,
                    message=ts.action_required,
                    db=db,
                )
            elif ts.status == "approaching":
                summary["approaching"] += 1
                record_threshold_alert(
                    tenant_id=tenant_id,
                    alert_type="approaching_threshold",
                    rolling_value_gbp=ts.rolling_12m_value_gbp,
                    message=ts.action_required,
                    db=db,
                )
            # "registered" and "below_threshold" generate no alerts

        except Exception as exc:  # noqa: BLE001
            summary["errors"] += 1
            _log.warning(
                "monthly_threshold_check: tenant=%s error=%s",
                tenant_id, exc,
            )

    _log.info(
        "monthly_threshold_check: done total=%d approaching=%d "
        "threshold_met=%d errors=%d",
        summary["total"],
        summary["approaching"],
        summary["threshold_met"],
        summary["errors"],
    )
    return summary
