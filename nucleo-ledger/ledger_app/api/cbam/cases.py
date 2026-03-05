from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import text

from . import _shared

router = APIRouter()


@router.post("/scope-check")
def cbam_scope_check(payload: _shared.CBAMScopeCheckRequest):
    """Pre-import CBAM scope determination (EU 2023/956 Art. 2).

    Checks three conditions in sequence:
    1. Annex I — is the CN code covered by CBAM?
    2. Annex II / EU origin — is the country of origin excluded?
    3. De minimis — is the consignment value ≤ EUR 150?
    4. EORI format — does the importer EORI match the EU format?

    Returns one of:
    - ``in_scope``        A CBAM declaration is required.
    - ``out_of_scope``    A definitive exclusion applies; no declaration needed.
    - ``requires_review`` The CN code is covered but a factor needs human review
                          (missing origin, invalid EORI, etc.).
    """
    result = _shared.determine_cbam_scope(
        cn_code=payload.cn_code,
        origin_country=payload.origin_country,
        consignment_value_eur=payload.consignment_value_eur,
        importer_eori=payload.importer_eori,
    )
    return {
        "status": result.status.value,
        "sector": result.sector,
        "cn_code": result.cn_code,
        "origin_country": result.origin_country,
        "consignment_value_eur": result.consignment_value_eur,
        "importer_eori": result.importer_eori,
        "reasons": result.reasons,
        "regulation_refs": result.regulation_refs,
    }


@router.get("/carbon-pricing-schemes")
def list_carbon_pricing_schemes():
    """List all third-country carbon pricing schemes recognised for Art. 9 deduction.

    Returns the table of origin countries that have a carbon pricing mechanism
    recognised by the EU under EU Regulation 2023/956 Article 9.  When goods
    originate from one of these countries and a carbon price has been paid, the
    CBAM liability can be reduced proportionally.

    Countries whose ETS is *linked* to the EU ETS (Annex II: IS, LI, NO, CH)
    are excluded from CBAM entirely and therefore do not appear in this list.
    """
    schemes = _shared.get_all_recognised_schemes()
    return {
        "schemes": [
            {
                "country_code": s.country_code,
                "scheme_name": s.scheme_name,
                "scheme_type": s.scheme_type,
                "regulation_ref": s.regulation_ref,
                "notes": s.notes,
            }
            for s in schemes
        ],
        "count": len(schemes),
        "regulation_ref": "EU Regulation 2023/956, Article 9",
    }


@router.post("/cases", status_code=status.HTTP_201_CREATED)
def create_cbam_case(request: Request, payload: _shared.CBAMCaseCreate):
    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")
    with _shared.engine.begin() as conn:
        columns = _shared._table_columns(conn, "cbam_cases")
        _shared.set_tenant_context(conn, tenant_id)

        insert_payload: dict[str, object] = {
            "id": str(uuid4()),
            "importer_eori": _shared.encrypt_field(payload.importer_eori),
            "reporting_year": payload.reporting_year,
            "reporting_quarter": payload.reporting_quarter,
        }

        if "importer_name" in columns:
            insert_payload["importer_name"] = payload.importer_eori
        if "status" in columns:
            insert_payload["status"] = "draft"
        if "tenant_id" in columns:
            insert_payload["tenant_id"] = tenant_id

        created = _shared._insert_returning(conn, "cbam_cases", insert_payload)
        return created


@router.get("/cases/{case_id}")
def get_cbam_case(request: Request, case_id: str):
    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")
    with _shared.engine.begin() as conn:
        columns = _shared._table_columns(conn, "cbam_cases")
        _shared._enforce_tenant_id(columns, tenant_id)
        _shared.set_tenant_context(conn, tenant_id)
        tenant_filter = "AND tenant_id = :tenant_id" if "tenant_id" in columns else ""
        rows = conn.execute(
            text(
                f"""
                SELECT *
                FROM cbam.cbam_cases
                WHERE id = :id {tenant_filter}
                LIMIT 1
                """
            ),
            {"id": str(case_id), "tenant_id": tenant_id},
        ).mappings().all()

        if not rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

        result = dict(rows[0])
        if "importer_eori" in result:
            result["importer_eori"] = _shared.decrypt_field(result["importer_eori"])
        return result


@router.get("/cases")
def list_cbam_cases(
    request: Request,
    importer_eori: str | None = None,
    reporting_year: int | None = None,
    reporting_quarter: int | None = Query(default=None, ge=1, le=4),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
):
    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")
    with _shared.engine.begin() as conn:
        columns = _shared._table_columns(conn, "cbam_cases")
        _shared._enforce_tenant_id(columns, tenant_id)
        _shared.set_tenant_context(conn, tenant_id)
        order_by = (
            "created_at DESC"
            if "created_at" in columns
            else "reporting_year DESC, reporting_quarter DESC"
        )

        filters: list[str] = []
        params: dict[str, object] = {}

        if "tenant_id" in columns:
            filters.append("tenant_id = :tenant_id")
            params["tenant_id"] = tenant_id
        if importer_eori is not None:
            filters.append("importer_eori = :importer_eori")
            params["importer_eori"] = importer_eori
        if reporting_year is not None:
            filters.append("reporting_year = :reporting_year")
            params["reporting_year"] = reporting_year
        if reporting_quarter is not None:
            filters.append("reporting_quarter = :reporting_quarter")
            params["reporting_quarter"] = reporting_quarter

        where_sql = f"WHERE {' AND '.join(filters)}" if filters else ""
        params["limit"] = limit
        params["offset"] = offset
        rows = conn.execute(
            text(
                f"""
                SELECT *
                FROM cbam.cbam_cases
                {where_sql}
                ORDER BY {order_by}
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        ).mappings().all()

        return {"items": [dict(row) for row in rows], "offset": offset, "limit": limit, "count": len(rows)}
