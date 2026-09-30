"""Carbon Price Relief (CPR) endpoints — UK CBAM.

Route prefix: /api/cbam/cpr  (registered in main.py with prefix="/api")

Endpoints
---------
GET  /cbam/cpr/qualifying-schemes          List/check recognised CPR schemes
GET  /cbam/cpr/exchange-rate               HMRC's rate for a currency in the month of a date
POST /cbam/cpr/calculate                   Pure CPR calculation (no DB write)
POST /cbam/cpr/claims                      Create a CPR claim and persist to DB
GET  /cbam/cpr/claims/{goods_line_id}      List all CPR claims for a goods line
POST /cbam/cpr/upload-verification/{gid}   Upload accredited verifier document

Auth: all endpoints require Bearer JWT (applied at router level in main.py).
Mutations require the ``cbam:write`` scope.

Regulatory basis: Finance No.2 Bill 2025-26, HMRC Secondary Legislation Feb 2026.
"""

from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.services.cpr_calculator import (
    CPRValidationError,
    calculate_cpr,
    get_qualifying_schemes,
    scheme_currency,
)
from app.services.cpr_reference import (
    CPR_REFERENCE_VERSION,
    ExchangeRateUnavailable,
    get_reference_exchange_rate,
)
from app.services.cpr_repository import (
    lookup_qualifying_schemes_db,
)
from shared_auth.dependencies import require_scopes
from shared_auth.models import AuthContext

_log = logging.getLogger("nucleos.cpr")

router = APIRouter(prefix="/cbam/cpr", tags=["cpr"])

# Shared engine + helpers (same DB as the CBAM ledger)
from ledger_app.api.cbam._shared import (
    engine,
    set_tenant_context,
    _table_columns,
    _insert_returning,
)


# Pydantic models

class CPRCalculateRequest(BaseModel):
    """Input for the pure CPR calculation endpoint.  No DB write occurs."""

    verified_emissions_tco2e: Decimal = Field(
        ..., gt=0,
        description="Embedded emissions (tCO₂e) verified by a GACI-accredited verifier.",
    )
    carbon_price_local: Decimal = Field(
        ..., ge=0,
        description=(
            "Carbon price paid per tCO₂e in the origin country's scheme, "
            "in the scheme's local currency."
        ),
    )
    currency_code: str = Field(
        ..., min_length=3, max_length=3,
        description="ISO 4217 currency code of the scheme (e.g. 'EUR', 'CHF').",
    )
    free_allocations: Decimal = Field(
        default=Decimal("0"), ge=0,
        description=(
            "Value of free CO₂e allowances received per tCO₂e of product. "
            "Reduces the effective carbon price."
        ),
    )
    rebates: Decimal = Field(
        default=Decimal("0"), ge=0,
        description="Direct cash rebates received from the scheme authority per tCO₂e.",
    )
    exchange_rate_to_gbp: Decimal = Field(
        ..., gt=0,
        description=(
            "HMRC CDRM exchange rate from currency_code to GBP on the import date. "
            "Retrieve via GET /cbam/cpr/exchange-rates or supply your own with the import date."
        ),
    )
    cbam_liability_gbp: Decimal | None = Field(
        default=None, ge=0,
        description=(
            "CBAM liability (£) for this goods line — CPR cannot exceed this. "
            "Omit to preview the relief uncapped; the HMRC return caps it at the line's charge."
        ),
    )


class CPRVerificationReference(BaseModel):
    document_ref: str = Field(
        ..., min_length=1, max_length=500,
        description="Arbor's reference for the stored verification statement.",
    )
    document_sha256: str = Field(
        ..., pattern=r"^[0-9a-f]{64}$",
        description="SHA-256 of the statement, computed by Arbor when it was stored.",
    )


class CPRClaimCreate(BaseModel):
    """Input for creating a persisted CPR claim in cbam_cpr_claims."""

    goods_line_id: UUID = Field(..., description="FK to cbam_goods_lines.id.")
    origin_country_code: str = Field(
        ..., min_length=2, max_length=2,
        description="ISO 3166-1 alpha-2 code of the goods' country of origin.",
    )
    qualifying_scheme_name: str = Field(
        ..., min_length=1, max_length=200,
        description="Name of the qualifying carbon pricing scheme (from cbam_qualifying_schemes).",
    )
    carbon_price_local_currency: Decimal = Field(
        ..., ge=0,
        description="Carbon price per tCO₂e in local currency.",
    )
    local_currency_code: str = Field(
        ..., min_length=3, max_length=3,
        description="ISO 4217 code of the local currency.",
    )
    free_allocations_received: Decimal = Field(
        default=Decimal("0"), ge=0,
        description="Free allowances per tCO₂e (reduces effective price).",
    )
    rebates_received: Decimal = Field(
        default=Decimal("0"), ge=0,
        description="Direct rebates per tCO₂e.",
    )
    verified_emissions_tco2e: Decimal = Field(
        ..., gt=0,
        description="Verified embedded emissions (tCO₂e) for this goods line.",
    )
    exchange_rate_to_gbp: Decimal = Field(
        ..., gt=0,
        description="HMRC CDRM exchange rate (local currency → GBP) on the import date.",
    )
    exchange_rate_date: date = Field(
        ..., description="Date on which the exchange rate applies (typically import date).",
    )
    cbam_liability_gbp: Decimal | None = Field(
        default=None, ge=0,
        description=(
            "CBAM liability (£) for this goods line — CPR cap. Omit to store the "
            "claim uncapped: the HMRC return caps relief at the line's own charge."
        ),
    )
    verifier_name: str | None = Field(
        default=None, max_length=200,
        description="Name of the GACI-accredited independent verifier.",
    )
    verifier_accreditation_body: str | None = Field(
        default=None, max_length=200,
        description=(
            "Accreditation body for the verifier "
            "(e.g. 'UKAS', 'DAkkS', 'COFRAC'). "
            "Must meet ISO 17029 / ISO 14064-3 / ISO 14065 / ISO 14066."
        ),
    )


# Helpers


def _tenant_id(request: Request) -> str:
    return getattr(getattr(request.state, "auth_context", None), "tenant_id", "") or ""


def _require_cbam_write(auth_context: AuthContext = Depends(require_scopes(["cbam:write"]))) -> AuthContext:
    return auth_context


def _schemes_for(conn, country: str) -> list[dict[str, Any]]:
    """The schemes recognised for an origin country, each with its currency."""
    rows = lookup_qualifying_schemes_db(conn, country)
    if not rows:
        # Fall back to in-memory registry for countries not yet in DB
        rows = [
            {
                "country_code": s.country_code,
                "scheme_name": s.scheme_name,
                "scheme_type": s.scheme_type,
                "recognition_status": s.recognition_status,
                "notes": s.notes,
            }
            for s in get_qualifying_schemes(country)
        ]
    return [{**r, "currency_code": scheme_currency(str(r["scheme_name"]))} for r in rows]


def _check_claim(conn, payload: CPRClaimCreate, tenant_id: str) -> None:
    """Refuse a claim the return must not carry.

    The goods line has to be this tenant's; the claim has to name the country
    the goods came from; and the scheme has to be one the UK recognises for that
    country. Relief under any other scheme would reduce the return by money the
    importer is not owed.
    """
    line = conn.execute(
        text(
            """
            SELECT sh.origin_country
            FROM   cbam.cbam_goods_lines gl
            JOIN   cbam.cbam_shipments   sh ON sh.id = gl.shipment_id
            JOIN   cbam.cbam_cases       c  ON c.id = sh.case_id
            WHERE  gl.id = :goods_line_id AND c.tenant_id = :tenant_id
            """
        ),
        {"goods_line_id": str(payload.goods_line_id), "tenant_id": tenant_id},
    ).mappings().first()
    if line is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

    origin = payload.origin_country_code.upper()
    line_origin = (line["origin_country"] or "").strip().upper()
    if line_origin != origin:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"These goods came from {line_origin or 'an unrecorded country'}, not {origin}. "
                "Relief is claimed under a scheme of the country of origin."
            ),
        )

    confirmed = {
        s["scheme_name"] for s in _schemes_for(conn, origin) if s["recognition_status"] == "confirmed"
    }
    if payload.qualifying_scheme_name not in confirmed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"{payload.qualifying_scheme_name} is not a scheme the UK recognises for relief on goods "
                f"from {origin}."
            ),
        )


# Endpoints

@router.get("/qualifying-schemes")
def list_qualifying_schemes(
    country: str | None = Query(
        default=None,
        description="Filter by ISO 3166-1 alpha-2 country code (e.g. 'DE'). "
                    "Omit to return all recognised schemes.",
    ),
):
    """List qualifying carbon pricing schemes recognised for UK CBAM CPR.

    When ``country`` is provided, returns the scheme(s) for that origin
    country and whether CPR can currently be claimed.  If ``recognition_status``
    is ``pending``, CPR cannot yet be claimed — importer should monitor HMRC
    guidance.

    Data source: ``cbam.cbam_qualifying_schemes`` (seeded in migration 010).
    """
    with engine.begin() as conn:
        if country:
            rows = _schemes_for(conn, country)
            cpr_claimable = any(r["recognition_status"] == "confirmed" for r in rows)
            warning = None
            if any(r["recognition_status"] == "pending" for r in rows) and not cpr_claimable:
                warning = (
                    f"One or more schemes for '{country}' are pending UK HMRC confirmation. "
                    "CPR cannot be claimed until recognition_status = 'confirmed'."
                )
            return {
                "country_code": country.upper(),
                "cpr_claimable": cpr_claimable,
                "schemes": rows,
                "warning": warning,
            }

        # All schemes
        all_rows = conn.execute(
            text(
                """
                SELECT country_code, scheme_name, scheme_type,
                       recognition_status, effective_from, effective_to, notes
                FROM   cbam.cbam_qualifying_schemes
                ORDER  BY country_code, scheme_type, scheme_name
                """
            )
        ).mappings().all()
        return {
            "schemes": [{**dict(r), "currency_code": scheme_currency(r["scheme_name"])} for r in all_rows],
            "count": len(all_rows),
            "note": "Pre-seeded with EU ETS participants (indicative). "
                    "Update when HMRC publishes the official UK qualifying list.",
        }


@router.get("/exchange-rate")
def get_exchange_rate(
    currency: str = Query(..., min_length=3, max_length=3, description="ISO 4217 code, e.g. 'EUR'."),
    on: date = Query(..., alias="date", description="The date the rate applies to, normally the import date."),
):
    """HMRC's rate for *currency* in the calendar month of *date*.

    HMRC publishes one rate per currency per month, so only that month's rate
    is HMRC's rate for the date. The reference table falls back to the latest
    earlier rate it holds; an earlier month's rate is a different figure, so it
    is refused here rather than offered as this month's.
    """
    code = currency.strip().upper()
    month = on.replace(day=1)
    not_held = HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"HMRC's {code} rate for {on.strftime('%B %Y')} is not held in reference table {CPR_REFERENCE_VERSION}.",
    )
    try:
        rate, effective_from, source = get_reference_exchange_rate(code, on)
    except ExchangeRateUnavailable as exc:
        raise not_held from exc
    if code != "GBP" and effective_from != month:
        raise not_held
    return {
        "currency": code,
        "date": on.isoformat(),
        "rate": str(rate),
        "effective_from": effective_from.isoformat(),
        "source": source,
        "table_version": CPR_REFERENCE_VERSION,
    }


@router.post("/calculate")
def calculate_cpr_endpoint(payload: CPRCalculateRequest):
    """Pure CPR calculation — returns all intermediate values.  No DB write.

    Use this endpoint to verify a CPR calculation before committing it as a
    claim.  Pass the result to ``POST /cbam/cpr/claims`` to create a persisted
    record with verifier details.
    """
    try:
        result = calculate_cpr(
            verified_emissions_tco2e=payload.verified_emissions_tco2e,
            carbon_price_local=payload.carbon_price_local,
            currency_code=payload.currency_code,
            free_allocations=payload.free_allocations,
            rebates=payload.rebates,
            exchange_rate_to_gbp=payload.exchange_rate_to_gbp,
            cbam_liability_gbp=payload.cbam_liability_gbp,
        )
    except CPRValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": "CPR validation failed", "failures": exc.failures},
        )

    return {
        "verified_emissions_tco2e": str(result.verified_emissions_tco2e),
        "carbon_price_local":       str(result.carbon_price_local),
        "currency_code":            result.currency_code,
        "free_allocations":         str(result.free_allocations),
        "rebates":                  str(result.rebates),
        "net_price_local":          str(result.net_price_local),
        "exchange_rate_to_gbp":     str(result.exchange_rate_to_gbp),
        "effective_carbon_price_gbp": str(result.effective_carbon_price_gbp),
        "cpr_raw_gbp":              str(result.cpr_raw_gbp),
        "cpr_capped":               result.cpr_capped,
        "cpr_amount_gbp":           str(result.cpr_amount_gbp),
        "cbam_liability_gbp":       None if result.cbam_liability_gbp is None else str(result.cbam_liability_gbp),
        "warnings":                 result.warnings,
    }


@router.post("/claims", status_code=status.HTTP_201_CREATED)
def create_cpr_claim(
    request: Request,
    payload: CPRClaimCreate,
    auth: AuthContext = Depends(_require_cbam_write),
):
    """Create a CPR claim, calculate CPR, and persist to ``cbam_cpr_claims``.

    The CPR formula is applied server-side — callers supply the raw inputs
    and the API derives effective_carbon_price_gbp, cpr_raw_gbp, cpr_amount_gbp.
    All intermediate values are stored for audit purposes.

    Requires scope: ``cbam:write``.
    """
    tenant_id = _tenant_id(request)

    try:
        result = calculate_cpr(
            verified_emissions_tco2e=payload.verified_emissions_tco2e,
            carbon_price_local=payload.carbon_price_local_currency,
            currency_code=payload.local_currency_code,
            free_allocations=payload.free_allocations_received,
            rebates=payload.rebates_received,
            exchange_rate_to_gbp=payload.exchange_rate_to_gbp,
            cbam_liability_gbp=payload.cbam_liability_gbp,
        )
    except CPRValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": "CPR validation failed", "failures": exc.failures},
        )

    with engine.begin() as conn:
        columns = _table_columns(conn, "cbam_cpr_claims")
        set_tenant_context(conn, tenant_id)
        _check_claim(conn, payload, tenant_id)

        insert_payload: dict[str, Any] = {
            "id":                           str(uuid4()),
            "goods_line_id":                str(payload.goods_line_id),
            "tenant_id":                    tenant_id,
            "origin_country_code":          payload.origin_country_code.upper(),
            "qualifying_scheme_name":       payload.qualifying_scheme_name,
            "carbon_price_local_currency":  str(result.carbon_price_local),
            "local_currency_code":          result.currency_code,
            "free_allocations_received":    str(result.free_allocations),
            "rebates_received":             str(result.rebates),
            "net_price_local_currency":     str(result.net_price_local),
            "verified_emissions_tco2e":     str(result.verified_emissions_tco2e),
            "exchange_rate_to_gbp":         str(result.exchange_rate_to_gbp),
            "exchange_rate_date":           payload.exchange_rate_date.isoformat(),
            "effective_carbon_price_gbp":   str(result.effective_carbon_price_gbp),
            "cpr_raw_gbp":                  str(result.cpr_raw_gbp),
            "cpr_capped":                   result.cpr_capped,
            "cpr_amount_gbp":               str(result.cpr_amount_gbp),
            "cbam_liability_gbp":           None if result.cbam_liability_gbp is None else str(result.cbam_liability_gbp),
        }

        if "verifier_name" in columns and payload.verifier_name:
            insert_payload["verifier_name"] = payload.verifier_name
        if "verifier_accreditation_body" in columns and payload.verifier_accreditation_body:
            insert_payload["verifier_accreditation_body"] = payload.verifier_accreditation_body

        created = _insert_returning(conn, "cbam_cpr_claims", insert_payload)

    return {
        **dict(created),
        "warnings": result.warnings,
    }


@router.get("/claims/{goods_line_id}")
def list_cpr_claims(
    request: Request,
    goods_line_id: str,
):
    """Return all CPR claims for a goods line, ordered newest first.

    Requires the caller's tenant to own the underlying goods line (enforced
    via tenant_id filter).
    """
    tenant_id = _tenant_id(request)

    with engine.begin() as conn:
        columns = _table_columns(conn, "cbam_cpr_claims")
        set_tenant_context(conn, tenant_id)

        # Tenant isolation is mandatory, not conditional — if the schema has no
        # tenant_id column yet (migration gap), refuse to return rows rather than
        # risk leaking another tenant's CPR claims.
        if "tenant_id" not in columns:
            return {"goods_line_id": goods_line_id, "claims": [], "count": 0}

        rows = conn.execute(
            text(
                """
                SELECT *
                FROM   cbam.cbam_cpr_claims
                WHERE  goods_line_id = :goods_line_id
                AND    tenant_id = :tenant_id
                ORDER  BY created_at DESC
                """
            ),
            {"goods_line_id": goods_line_id, "tenant_id": tenant_id},
        ).mappings().all()

    return {
        "goods_line_id": goods_line_id,
        "claims": [dict(r) for r in rows],
        "count": len(rows),
    }


@router.post("/upload-verification/{goods_line_id}", status_code=status.HTTP_200_OK)
def record_verification_document(
    request: Request,
    goods_line_id: str,
    payload: CPRVerificationReference,
    auth: AuthContext = Depends(_require_cbam_write),
):
    """Record the verifier's statement for a goods line's relief claims.

    The statement is an Arbor document: Arbor stores the file and computes its
    SHA-256; this records the reference and hash on every claim for the line
    that has none yet. Nucleos holds no documents (integration rule 4).
    """
    tenant_id = _tenant_id(request)
    storage_path = payload.document_ref
    sha256_hex = payload.document_sha256

    # Update all CPR claims for this goods line that lack a verification document
    with engine.begin() as conn:
        columns = _table_columns(conn, "cbam_cpr_claims")
        set_tenant_context(conn, tenant_id)

        # Tenant isolation is mandatory, not conditional — without it this UPDATE
        # would write verification documents onto another tenant's CPR claims.
        if "tenant_id" not in columns:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="CPR claims table is missing tenant isolation. Contact support.",
            )

        result = conn.execute(
            text(
                """
                UPDATE cbam.cbam_cpr_claims
                SET    verification_document_path = :path,
                       verification_document_hash = :hash
                WHERE  goods_line_id = :goods_line_id
                  AND  verification_document_hash IS NULL
                  AND  tenant_id = :tenant_id
                RETURNING id, goods_line_id, cpr_amount_gbp,
                          verification_document_path, verification_document_hash
                """
            ),
            {
                "path":          storage_path,
                "hash":          sha256_hex,
                "goods_line_id": goods_line_id,
                "tenant_id":     tenant_id,
            },
        )
        updated_rows = result.mappings().all()

    if not updated_rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No unverified CPR claims found for goods_line_id={goods_line_id}. "
                "Create a claim first via POST /cbam/cpr/claims."
            ),
        )

    return {
        "message": f"Verification statement recorded for {len(updated_rows)} CPR claim(s).",
        "goods_line_id":             goods_line_id,
        "document_ref":              storage_path,
        "verification_document_hash": sha256_hex,
        "updated_claims":            [dict(r) for r in updated_rows],
    }
