"""CBAM Quarterly Reconciliation API.

Endpoints
---------
GET  /cbam/reconcile
    Aggregate all cases for a given (importer_eori, year, quarter) into a
    QuarterlyReconciliationResult.  Includes supplier SEE flags (B2) and
    carbon price plausibility flags (B3) in the response.

GET  /cbam/suppliers/{supplier_eori}/see-history
    Return rolling per-CN-code SEE history for a supplier so that callers can
    inspect the values used for the B2 deviation check.

Scopes required: ``cbam:read``
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, status

from ledger_app.api.cbam._shared import engine, _table_columns, _pick_existing
from ledger_app.services.cbam_reconciler import (
    QuarterlyReconciliationResult,
    reconcile_quarter,
    get_eua_reference_price,
)
from sqlalchemy import text

router = APIRouter(tags=["cbam-reconcile"])

_D = Decimal
_ZERO = _D("0")


# ── helpers ───────────────────────────────────────────────────────────────────

def _load_cases_for_quarter(
    tenant_id: str,
    importer_eori: str,
    year: int,
    quarter: int,
) -> list[dict]:
    """Pull all CBAM cases + goods lines + emissions for one reporting period."""
    with engine.connect() as conn:
        cases_cols = _table_columns(conn, "cbam_cases")
        shipments_cols = _table_columns(conn, "cbam_shipments")
        goods_cols = _table_columns(conn, "cbam_goods_lines")
        emissions_cols = _table_columns(conn, "cbam_emissions")

        case_fk = _pick_existing(shipments_cols, ["cbam_case_id", "case_id"])
        mass_col = _pick_existing(goods_cols, ["net_mass_kg", "quantity"])
        direct_col = _pick_existing(emissions_cols, ["direct_kgco2e", "direct_emissions_kgco2e", "direct_embedded_kgco2e"])
        indirect_col = _pick_existing(emissions_cols, ["indirect_kgco2e", "indirect_emissions_kgco2e", "indirect_embedded_kgco2e"])

        if not case_fk or not mass_col or not direct_col or not indirect_col:
            raise HTTPException(status_code=500, detail="Schema introspection failed")

        # Tenant filter clause
        tenant_clause = ""
        params: dict = {
            "eori": importer_eori,
            "year": year,
            "quarter": quarter,
        }
        if tenant_id and "tenant_id" in cases_cols:
            tenant_clause = "AND c.tenant_id = :tenant_id"
            params["tenant_id"] = tenant_id

        case_rows = conn.execute(
            text(f"""
                SELECT c.id, c.importer_eori, c.reporting_year, c.reporting_quarter,
                       c.status,
                       c.origin_country
                FROM cbam.cbam_cases c
                WHERE c.importer_eori = :eori
                  AND c.reporting_year = :year
                  AND c.reporting_quarter = :quarter
                  {tenant_clause}
                ORDER BY c.id
            """),
            params,
        ).mappings().all()

        cases = []
        for cr in case_rows:
            case_id = str(cr["id"])

            # Pull per-case carbon_price_paid if stored (may not exist yet)
            cp_paid = _ZERO
            if "carbon_price_paid_eur" in cases_cols:
                cp_paid = _D(str(cr.get("carbon_price_paid_eur") or 0))

            # Get goods lines with latest emissions
            gl_rows = conn.execute(
                text(f"""
                    WITH latest_e AS (
                        SELECT e.goods_line_id,
                               e.{direct_col}   AS direct_kgco2e,
                               e.{indirect_col} AS indirect_kgco2e
                        FROM cbam.cbam_emissions e
                        INNER JOIN (
                            SELECT goods_line_id, MAX(version) AS mv
                            FROM cbam.cbam_emissions GROUP BY goods_line_id
                        ) mx ON mx.goods_line_id = e.goods_line_id
                               AND mx.mv = e.version
                    )
                    SELECT
                        gl.id AS goods_line_id,
                        gl.cn_code,
                        gl.{mass_col} AS net_mass_kg,
                        COALESCE(le.direct_kgco2e,   0) AS direct_kgco2e,
                        COALESCE(le.indirect_kgco2e, 0) AS indirect_kgco2e
                    FROM cbam.cbam_goods_lines gl
                    JOIN cbam.cbam_shipments s ON s.id = gl.shipment_id
                    LEFT JOIN latest_e le ON le.goods_line_id = gl.id
                    WHERE s.{case_fk} = :case_id
                """),
                {"case_id": case_id},
            ).mappings().all()

            goods_lines = []
            for gl in gl_rows:
                # supplier_eori not yet a DB column — placeholder empty string
                goods_lines.append({
                    "goods_line_id": str(gl["goods_line_id"]),
                    "cn_code": str(gl["cn_code"] or ""),
                    "supplier_eori": "",
                    "net_mass_kg": _D(str(gl["net_mass_kg"] or 0)),
                    "direct_kgco2e": _D(str(gl["direct_kgco2e"] or 0)),
                    "indirect_kgco2e": _D(str(gl["indirect_kgco2e"] or 0)),
                })

            cases.append({
                "id": case_id,
                "importer_eori": str(cr["importer_eori"]),
                "reporting_year": int(cr["reporting_year"]),
                "reporting_quarter": int(cr["reporting_quarter"]),
                "carbon_price_paid_eur": cp_paid,
                "origin_country": str(cr.get("origin_country") or ""),
                "goods_lines": goods_lines,
            })

        return cases


def _load_supplier_see_history(
    tenant_id: str,
    importer_eori: str,
) -> dict[tuple[str, str], tuple[list[Decimal], list[str]]]:
    """Load historical supplier SEE values from the DB for B2 checks.

    Returns a dict keyed by (supplier_eori, cn_code) → (see_values, case_ids).
    Only populated when the supplier_see_history table exists (migration 006).
    """
    with engine.connect() as conn:
        try:
            params: dict = {"eori": importer_eori}
            tenant_clause = ""
            if tenant_id:
                tenant_clause = "AND tenant_id = :tenant_id"
                params["tenant_id"] = tenant_id

            rows = conn.execute(
                text(f"""
                    SELECT supplier_eori, cn_code, see_tco2e_per_t, case_id
                    FROM cbam.supplier_see_history
                    WHERE importer_eori = :eori
                      {tenant_clause}
                    ORDER BY reporting_period ASC
                """),
                params,
            ).mappings().all()
        except Exception:
            return {}

    history: dict[tuple[str, str], tuple[list[Decimal], list[str]]] = {}
    for r in rows:
        key = (str(r["supplier_eori"] or ""), str(r["cn_code"] or ""))
        if key not in history:
            history[key] = ([], [])
        history[key][0].append(_D(str(r["see_tco2e_per_t"])))
        history[key][1].append(str(r["case_id"] or ""))
    return history


def _result_to_dict(result: QuarterlyReconciliationResult) -> dict:
    """Serialize QuarterlyReconciliationResult to a JSON-safe dict."""
    def _dec(v):
        return float(v) if isinstance(v, Decimal) else v

    return {
        "importer_eori": result.importer_eori,
        "reporting_year": result.reporting_year,
        "reporting_quarter": result.reporting_quarter,
        "case_count": result.case_count,
        "shipment_count": result.shipment_count,
        "goods_line_count": result.goods_line_count,
        "total_net_mass_t": _dec(result.total_net_mass_t),
        "total_direct_tco2e": _dec(result.total_direct_tco2e),
        "total_indirect_tco2e": _dec(result.total_indirect_tco2e),
        "total_embedded_tco2e": _dec(result.total_embedded_tco2e),
        "total_carbon_price_deduction_tco2e": _dec(result.total_carbon_price_deduction_tco2e),
        "net_liability_tco2e": _dec(result.net_liability_tco2e),
        "cbam_certificates_required": result.cbam_certificates_required,
        "eu_ets_price_eur": _dec(result.eu_ets_price_eur),
        "gross_financial_liability_eur": _dec(result.gross_financial_liability_eur),
        "net_financial_liability_eur": _dec(result.net_financial_liability_eur),
        "supplier_see_flags": [
            {
                "supplier_eori": f.supplier_eori,
                "cn_code": f.cn_code,
                "current_see": _dec(f.current_see),
                "rolling_mean": _dec(f.rolling_mean),
                "deviation_pct": _dec(f.deviation_pct),
                "threshold_pct": _dec(f.threshold_pct),
                "case_ids": f.case_ids,
            }
            for f in result.supplier_see_flags
        ],
        "carbon_price_flags": [
            {
                "origin_country": f.origin_country,
                "declared_price_eur": _dec(f.declared_price_eur),
                "reference_price_eur": _dec(f.reference_price_eur),
                "ratio": _dec(f.ratio),
                "direction": f.direction,
            }
            for f in result.carbon_price_flags
        ],
        "case_ids": result.case_ids,
        "regulation_refs": result.regulation_refs,
    }


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/reconcile")
async def reconcile_quarterly(
    request,
    importer_eori: str = Query(..., description="Importer EORI number"),
    year: int = Query(..., ge=2023, le=2100, description="Reporting year"),
    quarter: int = Query(..., ge=1, le=4, description="Reporting quarter (1–4)"),
    eu_ets_price_eur: float | None = Query(
        default=None,
        description=(
            "EU ETS allowance price (EUR/tCO2e) for financial liability calculation. "
            "When omitted, the indicative quarterly reference price is used."
        ),
    ),
):
    """Aggregate all CBAM cases for one quarterly reporting period.

    Returns total embedded emissions, CBAM certificate requirement, Art. 9
    deduction, supplier SEE anomaly flags, and carbon price plausibility flags.

    Requires scope: ``cbam:read``
    """
    auth = getattr(request.state, "auth_context", None)
    tenant_id = getattr(auth, "tenant_id", "") or ""

    # Use indicative EUA reference if caller did not supply a price
    ets_price: Decimal | None = None
    if eu_ets_price_eur is not None:
        ets_price = _D(str(eu_ets_price_eur))
    else:
        ets_price = get_eua_reference_price(year, quarter)

    cases = _load_cases_for_quarter(tenant_id, importer_eori, year, quarter)
    history = _load_supplier_see_history(tenant_id, importer_eori)

    result = reconcile_quarter(
        cases=cases,
        importer_eori=importer_eori,
        reporting_year=year,
        reporting_quarter=reporting_quarter if False else quarter,  # keep name consistent
        eu_ets_price_eur=ets_price,
        supplier_see_history=history if history else None,
    )

    return _result_to_dict(result)


@router.get("/suppliers/{supplier_eori}/see-history")
async def get_supplier_see_history(
    request,
    supplier_eori: str,
    cn_code: str | None = Query(default=None, description="Filter by CN code"),
    importer_eori: str | None = Query(default=None, description="Filter by importer EORI"),
):
    """Return rolling SEE history for a supplier across all CN codes (or a specific one).

    Useful for auditors and compliance officers to inspect the values used in
    the B2 supplier consistency check.

    Requires scope: ``cbam:read``
    """
    auth = getattr(request.state, "auth_context", None)
    tenant_id = getattr(auth, "tenant_id", "") or ""

    with engine.connect() as conn:
        try:
            params: dict = {"supplier_eori": supplier_eori}
            filters = ["supplier_eori = :supplier_eori"]

            if cn_code:
                filters.append("cn_code = :cn_code")
                params["cn_code"] = cn_code
            if importer_eori:
                filters.append("importer_eori = :importer_eori")
                params["importer_eori"] = importer_eori
            if tenant_id:
                filters.append("tenant_id = :tenant_id")
                params["tenant_id"] = tenant_id

            where = " AND ".join(filters)
            rows = conn.execute(
                text(f"""
                    SELECT supplier_eori, cn_code, see_tco2e_per_t,
                           reporting_period, case_id
                    FROM cbam.supplier_see_history
                    WHERE {where}
                    ORDER BY cn_code, reporting_period ASC
                """),
                params,
            ).mappings().all()
        except Exception:
            return {"supplier_eori": supplier_eori, "history": [], "note": "No history table yet"}

    return {
        "supplier_eori": supplier_eori,
        "history": [
            {
                "cn_code": str(r["cn_code"]),
                "see_tco2e_per_t": float(_D(str(r["see_tco2e_per_t"]))),
                "reporting_period": str(r["reporting_period"]),
                "case_id": str(r["case_id"]),
            }
            for r in rows
        ],
    }
