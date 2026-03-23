"""CBAM Sourcing Insights API.

Transforms processed shipment data into carbon-aware sourcing intelligence.
All endpoints require the ``cbam:read`` scope.

Endpoints
---------
GET  /cbam/insights/kpis
    Dashboard headline figures for one importer / reporting period.
    Returns total projected CBAM cost, certificate count, CO2e totals,
    method breakdown (actual/estimated/default), top-5 CN codes.

GET  /cbam/insights/supplier-comparison
    Rank all suppliers (grouped by origin_country) for a given CN code by
    carbon intensity (SEE tCO2e/t) and projected CBAM cost.
    Reveals which source country has the lowest carbon exposure.

GET  /cbam/insights/country-intensity
    Rank all origin countries by total embedded CO2e and weighted average
    SEE across all goods lines.

GET  /cbam/insights/sector-summary
    Break emissions and CBAM cost by CBAM sector (cement, iron_steel, etc.)
    with share-of-total percentages.

Query parameters common to all endpoints
-----------------------------------------
importer_eori : str (required)
    Importer EORI number.
reporting_year : int (optional)
    Filter to a specific reporting year.
reporting_quarter : int (optional, 1-4)
    Filter to a specific quarter.
eu_ets_price_eur : float (optional, default 50.0)
    EU ETS price used for CBAM cost projections.

Regulation references
---------------------
EU Regulation 2023/956, Articles 5, 7, 22(5)
Commission Implementing Regulation 2023/1773, Article 3
"""

from __future__ import annotations

import dataclasses
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status

from ledger_app.api.cbam._shared import engine, set_tenant_context, _table_columns
from ledger_app.services.cbam_insights_service import (
    get_importer_kpis,
    get_supplier_comparison,
    get_country_intensity,
    get_sector_summary,
)

router = APIRouter(tags=["cbam-insights"])

_D = Decimal


def _to_jsonable(obj: Any) -> Any:
    """Recursively convert dataclasses and Decimals for JSON serialisation."""
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {k: _to_jsonable(v) for k, v in dataclasses.asdict(obj).items()}
    if isinstance(obj, list):
        return [_to_jsonable(i) for i in obj]
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, set):
        return sorted(obj)
    return obj


def _require_importer(importer_eori: str | None) -> str:
    if not importer_eori or not importer_eori.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="importer_eori is required",
        )
    return importer_eori.strip()


@router.get("/insights/kpis")
def cbam_importer_kpis(
    request: Request,
    importer_eori: str = Query(..., description="Importer EORI"),
    reporting_year: int | None = Query(None, ge=2023),
    reporting_quarter: int | None = Query(None, ge=1, le=4),
    eu_ets_price_eur: float = Query(50.0, ge=0, description="EU ETS reference price (EUR/tCO2e)"),
):
    """Return headline dashboard KPIs for one importer.

    Aggregates across all CBAM cases visible to this tenant, optionally
    filtered to a reporting year and/or quarter.

    Response fields
    ---------------
    total_cases, total_shipments, total_goods_lines
    total_net_mass_t            — total imported mass (tonnes)
    total_direct_kgco2e         — sum of direct embedded emissions
    total_indirect_kgco2e       — sum of indirect embedded emissions
    total_embedded_tco2e        — (direct + indirect) / 1000
    projected_cbam_cost_eur     — ceil(embedded_tco2e) × eu_ets_price_eur
    cbam_certificates_required  — rounded-up certificate count (Art. 22(5))
    method_breakdown            — {"actual": n, "estimated": n, "default": n}
    top_cn_codes                — top-5 CN codes by embedded CO2e
    """
    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")
    eori = _require_importer(importer_eori)
    try:
        with engine.connect() as conn:
            set_tenant_context(conn, tenant_id)
            result = get_importer_kpis(
                conn,
                tenant_id=tenant_id,
                importer_eori=eori,
                year=reporting_year,
                quarter=reporting_quarter,
                eu_ets_price_eur=_D(str(eu_ets_price_eur)),
            )
        return _to_jsonable(result)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/insights/supplier-comparison")
def cbam_supplier_comparison(
    request: Request,
    importer_eori: str = Query(..., description="Importer EORI"),
    cn_code: str = Query(..., description="8-digit CN code to compare suppliers for"),
    reporting_year: int | None = Query(None, ge=2023),
    reporting_quarter: int | None = Query(None, ge=1, le=4),
    eu_ets_price_eur: float = Query(50.0, ge=0),
):
    """Compare all suppliers (grouped by origin country) for one CN code.

    Ranks them by carbon intensity (SEE tCO2e/t) and projected CBAM cost.
    Identifies the lowest-carbon supplier and the potential cost saving vs.
    the highest-carbon supplier — the core of carbon-aware sourcing.

    Response fields
    ---------------
    cn_code, sector, eu_ets_price_eur
    lowest_carbon_supplier      — origin country with lowest SEE
    highest_carbon_supplier     — origin country with highest SEE
    potential_saving_eur        — cost difference between best and worst supplier
    suppliers[]
      supplier_identifier       — ISO 2-letter origin country (or 'UNKNOWN')
      carbon_intensity_rank     — 1 = lowest (best)
      see_direct_tco2e_per_t    — direct specific embedded emissions
      see_total_tco2e_per_t     — total SEE (direct + indirect)
      projected_cbam_cost_eur
      total_embedded_tco2e
      goods_line_count
    """
    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")
    eori = _require_importer(importer_eori)
    cn = cn_code.strip().replace(" ", "")
    if not cn:
        raise HTTPException(status_code=422, detail="cn_code is required")
    try:
        with engine.connect() as conn:
            set_tenant_context(conn, tenant_id)
            result = get_supplier_comparison(
                conn,
                tenant_id=tenant_id,
                importer_eori=eori,
                cn_code=cn,
                year=reporting_year,
                quarter=reporting_quarter,
                eu_ets_price_eur=_D(str(eu_ets_price_eur)),
            )
        return _to_jsonable(result)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/insights/country-intensity")
def cbam_country_intensity(
    request: Request,
    importer_eori: str = Query(..., description="Importer EORI"),
    reporting_year: int | None = Query(None, ge=2023),
    reporting_quarter: int | None = Query(None, ge=1, le=4),
    eu_ets_price_eur: float = Query(50.0, ge=0),
):
    """Rank all origin countries by carbon intensity and embedded CO2e.

    Helps identify which import corridors carry the highest carbon cost.

    Response fields
    ---------------
    countries[] (ranked DESC by total_embedded_tco2e)
      origin_country
      carbon_intensity_rank       — 1 = highest emissions (worst first)
      total_embedded_tco2e
      avg_see_tco2e_per_t         — mass-weighted average SEE across all goods
      projected_cbam_cost_eur
      goods_line_count
    """
    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")
    eori = _require_importer(importer_eori)
    try:
        with engine.connect() as conn:
            set_tenant_context(conn, tenant_id)
            result = get_country_intensity(
                conn,
                tenant_id=tenant_id,
                importer_eori=eori,
                year=reporting_year,
                quarter=reporting_quarter,
                eu_ets_price_eur=_D(str(eu_ets_price_eur)),
            )
        return _to_jsonable(result)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/insights/sector-summary")
def cbam_sector_summary(
    request: Request,
    importer_eori: str = Query(..., description="Importer EORI"),
    reporting_year: int | None = Query(None, ge=2023),
    reporting_quarter: int | None = Query(None, ge=1, le=4),
    eu_ets_price_eur: float = Query(50.0, ge=0),
):
    """Break emissions and CBAM cost by CBAM sector.

    Shows which sectors (cement, iron_steel, aluminium, etc.) dominate
    the importer's carbon exposure.

    Response fields
    ---------------
    total_embedded_tco2e
    total_projected_cost_eur
    sectors[] (ranked DESC by total_embedded_tco2e)
      sector
      cn_codes                    — distinct CN codes in this sector
      share_of_total_pct          — percentage of total embedded CO2e
      total_embedded_tco2e
      avg_see_tco2e_per_t
      projected_cbam_cost_eur
      goods_line_count
    """
    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")
    eori = _require_importer(importer_eori)
    try:
        with engine.connect() as conn:
            set_tenant_context(conn, tenant_id)
            result = get_sector_summary(
                conn,
                tenant_id=tenant_id,
                importer_eori=eori,
                year=reporting_year,
                quarter=reporting_quarter,
                eu_ets_price_eur=_D(str(eu_ets_price_eur)),
            )
        return _to_jsonable(result)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
