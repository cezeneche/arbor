"""Carbon Price Relief (CPR) endpoints — UK CBAM.

Route prefix: /api/cbam/cpr  (registered in main.py with prefix="/api")

Endpoints
---------
GET  /cbam/cpr/qualifying-schemes          List/check recognised CPR schemes
GET  /cbam/cpr/exchange-rates              List HMRC reference exchange rates
POST /cbam/cpr/calculate                   Pure CPR calculation (no DB write)
POST /cbam/cpr/claims                      Create a CPR claim and persist to DB
GET  /cbam/cpr/claims/{goods_line_id}      List all CPR claims for a goods line
POST /cbam/cpr/upload-verification/{gid}   Upload accredited verifier document

Auth: all endpoints require Bearer JWT (applied at router level in main.py).
Mutations require the ``cbam:write`` scope.

Regulatory basis: Finance No.2 Bill 2025-26, HMRC Secondary Legislation Feb 2026.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import asdict
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.services.cpr_calculator import (
    CPRValidationError,
    calculate_cpr,
    get_exchange_rate_db,
    get_qualifying_schemes,
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
from ledger_app.api.cbam._shared import encrypt_field, decrypt_field


# ── Pydantic models ────────────────────────────────────────────────────────────

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
    cbam_liability_gbp: Decimal = Field(
        ..., ge=0,
        description="CBAM liability (£) for this goods line — CPR cannot exceed this.",
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
    cbam_liability_gbp: Decimal = Field(
        ..., ge=0,
        description="CBAM liability (£) for this goods line — CPR cap.",
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


class ExchangeRateOverrideRequest(BaseModel):
    """Optional override rate for a specific import date."""
    from_currency: str = Field(..., min_length=3, max_length=3)
    target_date: date
    to_currency: str = Field(default="GBP", min_length=3, max_length=3)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _decimal_default(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        return str(obj)
    if isinstance(obj, date):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serialisable")


def _tenant_id(request: Request) -> str:
    return getattr(getattr(request.state, "auth_context", None), "tenant_id", "") or ""


def _require_cbam_write(auth_context: AuthContext = Depends(require_scopes(["cbam:write"]))) -> AuthContext:
    return auth_context


# ── Endpoints ─────────────────────────────────────────────────────────────────

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
            rows = lookup_qualifying_schemes_db(conn, country)
            if not rows:
                # Fall back to in-memory registry for countries not yet in DB
                in_mem = get_qualifying_schemes(country)
                if in_mem:
                    rows = [
                        {
                            "country_code": s.country_code,
                            "scheme_name": s.scheme_name,
                            "scheme_type": s.scheme_type,
                            "recognition_status": s.recognition_status,
                            "notes": s.notes,
                        }
                        for s in in_mem
                    ]
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
            "schemes": [dict(r) for r in all_rows],
            "count": len(all_rows),
            "note": "Pre-seeded with EU ETS participants (indicative). "
                    "Update when HMRC publishes the official UK qualifying list.",
        }


@router.get("/exchange-rates")
def list_exchange_rates(
    currency: str | None = Query(
        default=None,
        description="Filter by ISO 4217 from-currency (e.g. 'EUR').",
    ),
    target_date: date | None = Query(
        default=None,
        description="Return the rate effective on or before this date. "
                    "Defaults to today.",
    ),
):
    """Return HMRC reference exchange rates for CPR GBP conversion.

    Rates are seeded from the HMRC Customs Declarants Reference Manual (CDRM)
    periodic rate table.  Importers must use the rate prevailing on the import
    date; use the ``exchange_rate_date`` field in the CPR claim record.

    **Important:** placeholder rates are seeded in migration 010.  Replace
    with official HMRC CDRM rates before production use.
    """
    params: dict[str, Any] = {}
    filters = ["to_currency = 'GBP'"]

    if currency:
        filters.append("from_currency = :currency")
        params["currency"] = currency.upper().strip()

    if target_date:
        filters.append("effective_date <= :target_date")
        params["target_date"] = target_date

    where = "WHERE " + " AND ".join(filters) if filters else ""

    with engine.begin() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT DISTINCT ON (from_currency)
                       from_currency, to_currency, rate, effective_date, source
                FROM   cbam.cbam_exchange_rates
                {where}
                ORDER  BY from_currency, effective_date DESC
                """
            ),
            params,
        ).mappings().all()

    return {
        "rates": [dict(r) for r in rows],
        "count": len(rows),
        "note": (
            "HMRC CDRM placeholder rates — update monthly from "
            "https://www.gov.uk/guidance/exchange-rates-for-customs-and-vat"
        ),
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
        "cbam_liability_gbp":       str(result.cbam_liability_gbp),
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
            "cbam_liability_gbp":           str(result.cbam_liability_gbp),
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

        tenant_filter = "AND tenant_id = :tenant_id" if "tenant_id" in columns else ""
        rows = conn.execute(
            text(
                f"""
                SELECT *
                FROM   cbam.cbam_cpr_claims
                WHERE  goods_line_id = :goods_line_id
                {tenant_filter}
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
async def upload_verification_document(
    request: Request,
    goods_line_id: str,
    file: UploadFile = File(..., description="PDF verification report from the accredited verifier."),
    auth: AuthContext = Depends(_require_cbam_write),
):
    """Upload an accredited verifier's PDF to Supabase Storage and record its hash.

    The document is stored at:
        ``{tenant_id}/cpr/{goods_line_id}/verification_{timestamp}.pdf``

    The SHA-256 hash is computed locally before upload and recorded in
    ``cbam_cpr_claims.verification_document_hash``.  All CPR claims for this
    goods line that have no verification document are updated.

    Requires scope: ``cbam:write``.
    Accepted content type: ``application/pdf`` (enforced).
    """
    tenant_id = _tenant_id(request)

    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No filename supplied.",
        )

    content_type = file.content_type or ""
    if content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                "Verification documents must be PDF files "
                f"(received content-type: {content_type!r}). "
                "Only ISO-accredited verifier reports in PDF format are accepted."
            ),
        )

    data = await file.read()
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    # Compute SHA-256 before upload (tamper-evidence)
    sha256_hex = hashlib.sha256(data).hexdigest()

    # Upload to Supabase Storage
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"verification_{ts}.pdf"
    storage_path: str | None = None
    storage_uri: str | None = None

    try:
        from ledger_app.services.storage import upload_document_async

        upload_result = await upload_document_async(
            tenant_id=tenant_id,
            document_id=f"cpr/{goods_line_id}",
            filename=filename,
            data=data,
        )
        storage_path = upload_result.storage_path
        storage_uri  = upload_result.storage_uri
        _log.info(
            "CPR verification uploaded: path=%s sha256=%s size=%d",
            storage_path, sha256_hex, len(data),
        )
    except Exception as exc:
        _log.warning("Supabase Storage upload failed (non-fatal): %s", exc)
        # Record the hash even if storage is unavailable; the document can be
        # re-uploaded later.  Do not fail the request — the hash provides
        # tamper evidence independently of storage.
        storage_path = f"{tenant_id}/cpr/{goods_line_id}/{filename}"
        storage_uri  = None

    # Update all CPR claims for this goods line that lack a verification document
    with engine.begin() as conn:
        columns = _table_columns(conn, "cbam_cpr_claims")
        set_tenant_context(conn, tenant_id)

        tenant_filter = "AND tenant_id = :tenant_id" if "tenant_id" in columns else ""

        result = conn.execute(
            text(
                f"""
                UPDATE cbam.cbam_cpr_claims
                SET    verification_document_path = :path,
                       verification_document_hash = :hash
                WHERE  goods_line_id = :goods_line_id
                  AND  verification_document_hash IS NULL
                {tenant_filter}
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
        "message": f"Verification document recorded for {len(updated_rows)} CPR claim(s).",
        "goods_line_id":             goods_line_id,
        "storage_path":              storage_path,
        "storage_uri":               storage_uri,
        "verification_document_hash": sha256_hex,
        "file_size_bytes":           len(data),
        "updated_claims":            [dict(r) for r in updated_rows],
    }
