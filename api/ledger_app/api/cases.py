import json
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from datetime import date
from sqlalchemy import text
from ledger_app.db.session import engine
from ledger_app.services.audit_signer import get_prev_chain_hmac, sign_event
from shared_auth import require_scopes

router = APIRouter(tags=["cases"])


class CaseCreate(BaseModel):
    supplier_name: str = Field(..., min_length=1)
    supplier_country: str | None = None
    reporting_period_start: date
    reporting_period_end: date
    external_ref: str | None = None


def _get_auth(request: Request):
    return getattr(request.state, "auth_context", None)


def _check_case_access(conn, case_id: str, auth) -> None:
    """
    Raise 404 if case doesn't exist; 403 if caller doesn't have access.
    Admins (cbam:admin scope) bypass the ACL check.
    """
    row = conn.execute(
        text("SELECT owner_sub, tenant_id FROM cases WHERE id = :id"),
        {"id": case_id},
    ).mappings().one_or_none()

    if row is None:
        raise HTTPException(status_code=404, detail="Case not found")

    if auth is None:
        return  # no auth context (test mode) — allow

    # Admin bypass: cbam:admin scope can see any case in the tenant
    if "cbam:admin" in (auth.scopes or []):
        if row["tenant_id"] and auth.tenant_id and row["tenant_id"] != auth.tenant_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        return

    # Owner access
    if row["owner_sub"] == auth.sub:
        return

    # Legacy rows (no owner_sub): accessible by all authenticated users in same tenant
    if not row["owner_sub"]:
        return

    # ACL access
    acl = conn.execute(
        text("SELECT 1 FROM case_acl WHERE case_id = :cid AND sub = :sub LIMIT 1"),
        {"cid": case_id, "sub": auth.sub},
    ).fetchone()
    if acl:
        return

    raise HTTPException(status_code=403, detail="Forbidden")


@router.post("/cases", dependencies=[Depends(require_scopes(["cbam:write"]))])
def create_case(request: Request, payload: CaseCreate):
    auth = _get_auth(request)
    actor_sub = auth.sub if auth else "system"
    tenant_id = auth.tenant_id if auth else ""

    with engine.begin() as conn:
        row = conn.execute(
            text("""
                INSERT INTO cases (
                    supplier_name, supplier_country,
                    reporting_period_start, reporting_period_end,
                    external_ref, status, owner_sub, tenant_id
                )
                VALUES (
                    :supplier_name, :supplier_country,
                    :start, :end,
                    :external_ref, 'created', :owner_sub, :tenant_id
                )
                RETURNING id, supplier_name, supplier_country,
                          reporting_period_start, reporting_period_end,
                          status, owner_sub, tenant_id, created_at
            """),
            {
                "supplier_name": payload.supplier_name,
                "supplier_country": payload.supplier_country,
                "start": payload.reporting_period_start,
                "end": payload.reporting_period_end,
                "external_ref": payload.external_ref,
                "owner_sub": actor_sub,
                "tenant_id": tenant_id,
            },
        ).mappings().one()

        case_id = str(row["id"])
        event_json = json.dumps({"note": "case created via API"}, sort_keys=True)
        prev_hmac = get_prev_chain_hmac(case_id, conn)
        sig = sign_event(case_id, "case_created", actor_sub, event_json,
                         prev_hmac=prev_hmac)

        conn.execute(
            text("""
                INSERT INTO audit_log
                    (case_id, event_type, actor_type, actor_sub, event_json,
                     hmac_sha256, prev_hmac)
                VALUES
                    (:case_id, 'case_created', 'human', :actor_sub,
                     CAST(:event_json AS jsonb), :sig, :prev_hmac)
            """),
            {
                "case_id": case_id,
                "actor_sub": actor_sub,
                "event_json": event_json,
                "sig": sig,
                "prev_hmac": prev_hmac,
            },
        )

    return dict(row)


@router.get("/cases")
def list_cases(request: Request):
    auth = _get_auth(request)
    actor_sub = auth.sub if auth else None
    tenant_id = auth.tenant_id if auth else ""
    is_admin = auth and "cbam:admin" in (auth.scopes or [])

    with engine.connect() as conn:
        if is_admin:
            # Admins see all cases in their tenant
            rows = conn.execute(
                text("""
                    SELECT id, supplier_name, supplier_country,
                           reporting_period_start, reporting_period_end,
                           status, owner_sub, tenant_id, created_at
                    FROM cases
                    WHERE tenant_id = :tenant_id
                    ORDER BY created_at DESC
                """),
                {"tenant_id": tenant_id},
            ).mappings().all()
        elif actor_sub:
            # Regular users see cases they own or have ACL access to (plus legacy rows)
            rows = conn.execute(
                text("""
                    SELECT id, supplier_name, supplier_country,
                           reporting_period_start, reporting_period_end,
                           status, owner_sub, tenant_id, created_at
                    FROM cases
                    WHERE (
                        owner_sub = :sub
                        OR owner_sub IS NULL
                        OR EXISTS (
                            SELECT 1 FROM case_acl
                            WHERE case_acl.case_id = cases.id AND case_acl.sub = :sub
                        )
                    )
                    ORDER BY created_at DESC
                """),
                {"sub": actor_sub},
            ).mappings().all()
        else:
            rows = conn.execute(
                text("SELECT id, supplier_name, status, created_at FROM cases ORDER BY created_at DESC")
            ).mappings().all()

    return [dict(r) for r in rows]


@router.get("/cases/{case_id}")
def get_case(request: Request, case_id: str):
    auth = _get_auth(request)
    with engine.connect() as conn:
        _check_case_access(conn, case_id, auth)
        row = conn.execute(
            text("""
                SELECT id, supplier_name, supplier_country,
                       reporting_period_start, reporting_period_end,
                       status, review_status, owner_sub, tenant_id, created_at, updated_at
                FROM cases WHERE id = :id
            """),
            {"id": case_id},
        ).mappings().one_or_none()

    if row is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return dict(row)
