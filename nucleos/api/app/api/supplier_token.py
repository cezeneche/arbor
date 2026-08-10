"""Tokenised supplier emissions data form.

Protected endpoint (Bearer JWT required):
  POST /api/cbam/goods-lines/{goods_line_id}/supplier-token
      Generate a one-time token for a goods line. Returns {token, form_url, expires_at}.

Public endpoints (no auth — accessed directly by the supplier):
  GET  /api/public/supplier-form/{token}
      Return form context: CN code, sector, production route options.
  POST /api/public/supplier-form/{token}
      Accept submitted emissions data, write to cbam_emissions, expire token.

Regulatory basis:
  Finance (No.2) Bill 2025-26, s.7(3) — importer must obtain SEE data from
  the installation operator where Tier 1 actual data is available.
  EU 2023/1773, Art. 4(1)(a) — Tier 1 actual specific embedded emissions.
"""

from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.services.notifications import notify_importer_supplier_submitted, notify_supplier_form
from ledger_app.api.cbam import _shared
from ledger_app.api.cbam.audit_helpers import _write_audit_event
from ledger_app.api.cbam.db_helpers import _pick_existing, _table_columns
from ledger_app.db.session import engine
from shared_auth.dependencies import require_scopes
from shared_auth.models import AuthContext

_log = logging.getLogger("nucleos.supplier_token")

_TOKEN_TTL_DAYS = 30

_PRODUCTION_ROUTES: dict[str, list[tuple[str, str]]] = {
    "iron_steel": [
        ("BF-BOF",        "Blast furnace – basic oxygen furnace"),
        ("EAF",           "Electric arc furnace"),
        ("DRI-EAF",       "Direct reduced iron + electric arc furnace"),
        ("world_average", "World average (unknown route)"),
    ],
    "aluminium": [
        ("primary_electrolysis", "Primary electrolysis (from bauxite)"),
        ("secondary_remelt",     "Secondary remelt (from recycled scrap)"),
        ("world_average",        "World average (unknown route)"),
    ],
    "cement": [
        ("clinker_production", "Clinker production"),
        ("blended_cement",     "Blended cement"),
        ("world_average",      "World average (unknown route)"),
    ],
    "fertilisers": [
        ("haber_bosch_smr",           "Haber-Bosch (natural gas / SMR)"),
        ("haber_bosch_electrolysis",  "Haber-Bosch (green hydrogen / electrolysis)"),
        ("world_average",             "World average (unknown route)"),
    ],
    "hydrogen": [
        ("smr_without_ccs",        "SMR without CCS (grey hydrogen)"),
        ("smr_with_ccs",           "SMR with CCS (blue hydrogen)"),
        ("electrolysis_renewable", "Electrolysis – renewable electricity (green)"),
        ("world_average",          "World average (unknown route)"),
    ],
    "electricity": [
        ("world_average", "World average"),
    ],
}

_TOKEN_CONTEXT_QUERY = text("""
    SELECT
        t.id              AS token_id,
        t.tenant_id,
        t.case_id,
        t.goods_line_id,
        t.expires_at,
        t.used_at,
        gl.cn_code,
        gl.sector,
        gl.installation_name,
        sh.origin_country,
        cc.importer_name,
        cc.reporting_year
    FROM   cbam.cbam_supplier_tokens  t
    JOIN   cbam.cbam_goods_lines       gl ON gl.id = t.goods_line_id
    JOIN   cbam.cbam_shipments         sh ON sh.id = gl.shipment_id
    JOIN   cbam.cbam_cases             cc ON cc.id = t.case_id
    WHERE  t.token = :token
""")

public_router    = APIRouter(prefix="/public",  tags=["supplier-form"])
protected_router = APIRouter(prefix="/cbam",    tags=["supplier-outreach"])


def _web_base_url(request: Request) -> str:
    base = os.getenv("WEB_BASE_URL", "").rstrip("/")
    if not base:
        base = f"{request.url.scheme}://{request.url.netloc}"
    return base


def _validate_token(row: object | None) -> None:
    if row is None:
        raise HTTPException(status_code=404, detail="This link is invalid or has expired.")
    if row["used_at"] is not None:
        raise HTTPException(status_code=410, detail="This link has already been used.")
    expires_at = row["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="This link has expired.")


# ── Protected: generate token ──────────────────────────────────────────────────

class TokenRequest(BaseModel):
    supplier_email: str | None = None


class TokenResponse(BaseModel):
    token:          str
    form_url:       str
    expires_at:     datetime
    email_sent:     bool


@protected_router.post(
    "/goods-lines/{goods_line_id}/supplier-token",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
)
def generate_supplier_token(
    goods_line_id: UUID,
    request: Request,
    background: BackgroundTasks,
    body: TokenRequest = TokenRequest(),
    _auth: AuthContext = Depends(require_scopes(["cbam:write"])),
):
    auth      = getattr(request.state, "auth_context", None)
    tenant_id = getattr(auth, "tenant_id", "") or ""
    actor_sub = getattr(auth, "sub", "system")

    with _shared.engine.begin() as conn:
        row = conn.execute(
            text("""
                SELECT gl.id, gl.cn_code, sh.case_id, cc.importer_name
                FROM   cbam.cbam_goods_lines gl
                JOIN   cbam.cbam_shipments   sh ON sh.id = gl.shipment_id
                JOIN   cbam.cbam_cases       cc ON cc.id = sh.case_id
                WHERE  gl.id = :gl_id AND cc.tenant_id = :tenant_id
            """),
            {"gl_id": str(goods_line_id), "tenant_id": tenant_id},
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Goods line not found.")

        case_id       = str(row[2])
        cn_code       = row[1] or ""
        importer_name = row[3] or "Your customer"
        token         = secrets.token_urlsafe(32)
        expires_at    = datetime.now(timezone.utc) + timedelta(days=_TOKEN_TTL_DAYS)
        form_url      = f"{_web_base_url(request)}/supplier/{token}"

        conn.execute(
            text("""
                INSERT INTO cbam.cbam_supplier_tokens
                    (token, tenant_id, case_id, goods_line_id, created_by, expires_at,
                     recipient_email, email_sent_at)
                VALUES
                    (:token, :tenant_id, :case_id, :goods_line_id, :created_by, :expires_at,
                     :recipient_email, :email_sent_at)
            """),
            {
                "token":           token,
                "tenant_id":       tenant_id,
                "case_id":         case_id,
                "goods_line_id":   str(goods_line_id),
                "created_by":      actor_sub,
                "expires_at":      expires_at,
                "recipient_email": body.supplier_email,
                "email_sent_at":   datetime.now(timezone.utc) if body.supplier_email else None,
            },
        )

    _log.info(
        "supplier_token_generated: tenant=%s goods_line=%s email=%s",
        tenant_id, goods_line_id, body.supplier_email or "none",
    )

    if body.supplier_email:
        background.add_task(
            notify_supplier_form,
            supplier_email=body.supplier_email,
            form_url=form_url,
            cn_code=cn_code,
            importer_name=importer_name,
            expires_days=_TOKEN_TTL_DAYS,
        )

    return TokenResponse(
        token=token,
        form_url=form_url,
        expires_at=expires_at,
        email_sent=bool(body.supplier_email),
    )


# ── Public: serve form context ─────────────────────────────────────────────────

class FormContext(BaseModel):
    cn_code:            str
    sector:             str
    description:        str | None
    installation_name:  str | None
    origin_country:     str | None
    importer_name:      str | None
    reporting_year:     int
    production_routes:  list[dict]
    expires_at:         datetime


@public_router.get("/supplier-form/{token}", response_model=FormContext)
def get_supplier_form(token: str):
    with engine.connect() as conn:
        row = conn.execute(_TOKEN_CONTEXT_QUERY, {"token": token}).mappings().first()

    _validate_token(row)

    sector = row["sector"] or ""
    routes = [
        {"key": k, "label": l}
        for k, l in _PRODUCTION_ROUTES.get(sector, [("world_average", "World average")])
    ]

    return FormContext(
        cn_code=row["cn_code"],
        sector=sector,
        description=None,
        installation_name=row["installation_name"],
        origin_country=row["origin_country"],
        importer_name=row["importer_name"],
        reporting_year=int(row["reporting_year"]) if row["reporting_year"] else 2027,
        production_routes=routes,
        expires_at=row["expires_at"],
    )


# ── Public: accept submission ──────────────────────────────────────────────────

class FormSubmission(BaseModel):
    see_tco2e_per_t:   float = Field(..., gt=0, description="Direct specific embedded emissions in tCO₂e per tonne.")
    production_route:  str
    installation_name: str | None = None


@public_router.post("/supplier-form/{token}", status_code=status.HTTP_200_OK)
def submit_supplier_form(token: str, body: FormSubmission, request: Request, background: BackgroundTasks):
    with _shared.engine.begin() as conn:
        row = conn.execute(_TOKEN_CONTEXT_QUERY, {"token": token}).mappings().first()
        _validate_token(row)

        goods_line_id = str(row["goods_line_id"])
        case_id       = str(row["case_id"])
        tenant_id     = str(row["tenant_id"])

        # Resolve mass column (handles net_mass_kg or legacy quantity column)
        gl_cols  = _table_columns(conn, "cbam_goods_lines")
        mass_col = _pick_existing(gl_cols, ["net_mass_kg", "quantity"])
        net_mass_kg: Decimal | None = None
        if mass_col:
            mass_row = conn.execute(
                text(f"SELECT {mass_col} FROM cbam.cbam_goods_lines WHERE id = :id"),
                {"id": goods_line_id},
            ).fetchone()
            if mass_row and mass_row[0] is not None:
                net_mass_kg = Decimal(str(mass_row[0]))

        # SEE (tCO₂e/t) × mass (kg) = kgCO₂e  [t/t and 1000 kg/t cancel cleanly]
        if net_mass_kg:
            direct_kgco2e = Decimal(str(body.see_tco2e_per_t)) * net_mass_kg
        else:
            # No mass on file — store 1-tonne equivalent; importer can correct via the case
            direct_kgco2e = Decimal(str(body.see_tco2e_per_t)) * 1000

        em_cols    = _table_columns(conn, "cbam_emissions")
        direct_col = _pick_existing(em_cols, ["direct_kgco2e", "direct_emissions_kgco2e", "direct_embedded_kgco2e"])

        if not direct_col:
            raise HTTPException(status_code=500, detail="Emissions table schema not ready.")

        current_version = conn.execute(
            text("SELECT COALESCE(MAX(version), 0) FROM cbam.cbam_emissions WHERE goods_line_id = :gl"),
            {"gl": goods_line_id},
        ).scalar() or 0

        conn.execute(
            text(f"""
                INSERT INTO cbam.cbam_emissions
                    (id, goods_line_id, tenant_id, method, {direct_col}, production_route, version)
                VALUES
                    (gen_random_uuid(), :gl, :tenant_id, 'actual', :direct, :route, :ver)
            """),
            {
                "gl":        goods_line_id,
                "tenant_id": tenant_id,
                "direct":    float(direct_kgco2e),
                "route":     body.production_route,
                "ver":    current_version + 1,
            },
        )

        if body.installation_name:
            conn.execute(
                text("UPDATE cbam.cbam_goods_lines SET installation_name = :name WHERE id = :id"),
                {"name": body.installation_name, "id": goods_line_id},
            )

        conn.execute(
            text("UPDATE cbam.cbam_supplier_tokens SET used_at = NOW() WHERE token = :token"),
            {"token": token},
        )

        _write_audit_event(
            case_id,
            "supplier_emissions_submitted",
            {
                "goods_line_id":   goods_line_id,
                "see_tco2e_per_t": body.see_tco2e_per_t,
                "production_route": body.production_route,
                "method":          "actual",
                "source":          "supplier_form",
            },
            actor_sub="supplier_form",
            tenant_id=tenant_id,
        )

    # Look up the importer's contact email from their registration record.
    importer_email: str | None = None
    try:
        with _shared.engine.connect() as conn:
            email_row = conn.execute(
                text("""
                    SELECT (business_address::jsonb)->>'email' AS email
                    FROM   cbam.cbam_registration
                    WHERE  tenant_id = :tenant_id
                    LIMIT  1
                """),
                {"tenant_id": tenant_id},
            ).fetchone()
            if email_row:
                importer_email = email_row[0]
    except Exception as exc:
        _log.warning("supplier_form_submitted: could not resolve importer email: %s", exc)

    if importer_email:
        background.add_task(
            notify_importer_supplier_submitted,
            recipient_email=importer_email,
            case_id=case_id,
            cn_code=row["cn_code"],
            see_tco2e_per_t=body.see_tco2e_per_t,
            production_route=body.production_route,
            installation_name=body.installation_name,
            base_url=_web_base_url(request),
        )

    _log.info(
        "supplier_form_submitted: case=%s goods_line=%s see=%.4f route=%s",
        case_id, goods_line_id, body.see_tco2e_per_t, body.production_route,
    )
    return {"status": "received"}
