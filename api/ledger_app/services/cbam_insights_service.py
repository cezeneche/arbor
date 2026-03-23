"""CBAM Sourcing Insights Service.

Aggregates processed shipment data into actionable sourcing intelligence.

Once the platform has processed enough shipments, every record contains:
  - product category / CN code
  - supplier EORI (origin_country as proxy when supplier_eori absent)
  - country of origin
  - embedded emissions (kgCO2e direct + indirect)
  - CBAM cost estimate (EU ETS price × net liability tCO2e)

This service computes cross-case aggregates that turn compliance data into
carbon-aware procurement intelligence:

1. **Importer KPIs** — dashboard headline figures: total projected CBAM cost,
   highest-carbon shipments, emissions by method, certificate count.

2. **Supplier comparison** — for a given CN code (or sector), rank all suppliers
   by carbon intensity (SEE tCO2e/t) and projected CBAM cost.  Reveals which
   supplier of aluminium / steel / cement produces the lowest exposure.

3. **Country intensity** — rank origin countries by average emissions intensity
   and total embedded CO2e across all imported goods.

4. **Sector summary** — break emissions and CBAM cost by CBAM sector
   (cement, iron_steel, aluminium, fertilisers, hydrogen, electricity).

All queries run directly on the existing normalised tables:
  cbam_cases / cbam_shipments / cbam_goods_lines / cbam_emissions

No new tables are required.  Tenant isolation is applied via app-level
``tenant_id`` filtering (same pattern as the rest of the ledger).

Regulation references
---------------------
EU Regulation 2023/956, Article 5 — importer obligations (reporting)
EU Regulation 2023/956, Article 7 — embedded emissions
Commission Implementing Regulation 2023/1773, Article 3 — SEE formula
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

_D = Decimal
_ZERO = _D("0")


# ── Sector lookup (safe wrapper) ──────────────────────────────────────────────

def _sector(cn_code: str | None) -> str:
    """Return CBAM sector for a CN code, or 'unknown'."""
    if not cn_code:
        return "unknown"
    try:
        from ledger_app.api.cbam._shared import _infer_sector_from_cn_code
        return _infer_sector_from_cn_code(cn_code)
    except Exception:
        return "unknown"


# ── Shared SQL fragment helpers ───────────────────────────────────────────────

def _tenant_clause(tenant_id: str) -> str:
    """Return a WHERE / AND fragment for tenant isolation on cbam_cases."""
    return "AND c.tenant_id = :tenant_id" if tenant_id else ""


def _quarter_clause(has_year: bool, has_quarter: bool) -> str:
    parts = []
    if has_year:
        parts.append("AND c.reporting_year = :year")
    if has_quarter:
        parts.append("AND c.reporting_quarter = :quarter")
    return " ".join(parts)


# ── Result dataclasses ────────────────────────────────────────────────────────

@dataclass
class ImporterKPIs:
    """Dashboard headline figures for one importer / period.

    Attributes
    ----------
    importer_eori : str
    reporting_year : int | None
    reporting_quarter : int | None
    total_cases : int
    total_shipments : int
    total_goods_lines : int
    total_net_mass_t : Decimal
        Sum of net mass across all goods lines (tonnes).
    total_direct_kgco2e : Decimal
    total_indirect_kgco2e : Decimal
    total_embedded_tco2e : Decimal
        (direct + indirect) / 1000 for all goods lines.
    projected_cbam_cost_eur : Decimal
        Estimated CBAM cost at the provided EUA reference price.
        Computed as ceil(total_embedded_tco2e) × eu_ets_price_eur.
    cbam_certificates_required : int
        Rounded-up certificate count per EU 2023/956 Art. 22(5).
    method_breakdown : dict
        {"actual": n, "estimated": n, "default": n} — goods line counts by method.
    top_cn_codes : list[dict]
        Top-5 CN codes by total embedded emissions, each with cn_code, sector,
        total_embedded_tco2e, goods_line_count.
    """
    importer_eori: str
    reporting_year: int | None
    reporting_quarter: int | None
    total_cases: int = 0
    total_shipments: int = 0
    total_goods_lines: int = 0
    total_net_mass_t: Decimal = field(default_factory=lambda: _ZERO)
    total_direct_kgco2e: Decimal = field(default_factory=lambda: _ZERO)
    total_indirect_kgco2e: Decimal = field(default_factory=lambda: _ZERO)
    total_embedded_tco2e: Decimal = field(default_factory=lambda: _ZERO)
    projected_cbam_cost_eur: Decimal = field(default_factory=lambda: _ZERO)
    cbam_certificates_required: int = 0
    method_breakdown: dict = field(default_factory=dict)
    top_cn_codes: list[dict] = field(default_factory=list)


@dataclass
class SupplierEntry:
    """One supplier's aggregated figures for a given CN code."""
    supplier_identifier: str    # supplier EORI or origin_country fallback
    identifier_type: str        # "eori" | "origin_country"
    cn_code: str
    sector: str
    goods_line_count: int
    total_net_mass_t: Decimal
    total_direct_kgco2e: Decimal
    total_indirect_kgco2e: Decimal
    total_embedded_tco2e: Decimal
    see_direct_tco2e_per_t: Decimal     # direct SEE = direct_kgco2e / mass_kg
    see_total_tco2e_per_t: Decimal      # total SEE
    projected_cbam_cost_eur: Decimal
    carbon_intensity_rank: int = 0      # 1 = lowest (best), higher = worse


@dataclass
class SupplierComparisonResult:
    """Ranked supplier comparison for one CN code."""
    cn_code: str
    sector: str
    reporting_year: int | None
    reporting_quarter: int | None
    eu_ets_price_eur: Decimal
    suppliers: list[SupplierEntry] = field(default_factory=list)
    lowest_carbon_supplier: str | None = None
    highest_carbon_supplier: str | None = None
    potential_saving_eur: Decimal = field(default_factory=lambda: _ZERO)


@dataclass
class CountryEntry:
    """Aggregated figures for one origin country."""
    origin_country: str
    goods_line_count: int
    total_net_mass_t: Decimal
    total_embedded_tco2e: Decimal
    avg_see_tco2e_per_t: Decimal        # weighted average across goods lines
    projected_cbam_cost_eur: Decimal
    carbon_intensity_rank: int = 0


@dataclass
class CountryIntensityResult:
    """Ranked origin-country carbon intensity."""
    reporting_year: int | None
    reporting_quarter: int | None
    eu_ets_price_eur: Decimal
    countries: list[CountryEntry] = field(default_factory=list)


@dataclass
class SectorEntry:
    """Aggregated figures for one CBAM sector."""
    sector: str
    cn_codes: list[str]
    goods_line_count: int
    total_net_mass_t: Decimal
    total_direct_kgco2e: Decimal
    total_indirect_kgco2e: Decimal
    total_embedded_tco2e: Decimal
    avg_see_tco2e_per_t: Decimal
    projected_cbam_cost_eur: Decimal
    share_of_total_pct: Decimal = field(default_factory=lambda: _ZERO)


@dataclass
class SectorSummaryResult:
    """Emissions and CBAM cost broken down by CBAM sector."""
    reporting_year: int | None
    reporting_quarter: int | None
    eu_ets_price_eur: Decimal
    total_embedded_tco2e: Decimal
    total_projected_cost_eur: Decimal
    sectors: list[SectorEntry] = field(default_factory=list)


# ── Column introspection cache (per connection) ───────────────────────────────

def _cols(conn: Connection, table: str) -> set[str]:
    from ledger_app.api.cbam._shared import _table_columns
    return set(_table_columns(conn, table))


def _pick(cols: set[str], candidates: list[str]) -> str | None:
    for c in candidates:
        if c in cols:
            return c
    return None


# ── Core aggregation query ────────────────────────────────────────────────────

def _run_goods_line_query(
    conn: Connection,
    *,
    tenant_id: str,
    importer_eori: str,
    year: int | None,
    quarter: int | None,
    extra_select: str = "",
    extra_group: str = "",
    extra_where: str = "",
) -> list[dict]:
    """Execute a parameterised goods-line-level aggregation query.

    Always filters on importer_eori (and optionally year/quarter/tenant).
    Callers add extra SELECT / GROUP BY / WHERE fragments for their dimension.

    Returns a list of row mappings.
    """
    # Introspect schema
    cases_cols = _cols(conn, "cbam_cases")
    ships_cols = _cols(conn, "cbam_shipments")
    goods_cols = _cols(conn, "cbam_goods_lines")
    emiss_cols = _cols(conn, "cbam_emissions")

    case_fk = _pick(ships_cols, ["cbam_case_id", "case_id"]) or "cbam_case_id"
    mass_col = _pick(goods_cols, ["net_mass_kg", "quantity"]) or "net_mass_kg"
    direct_col = _pick(emiss_cols, ["direct_emissions_kgco2e", "direct_embedded_kgco2e"]) or "direct_embedded_kgco2e"
    indirect_col = _pick(emiss_cols, ["indirect_emissions_kgco2e", "indirect_embedded_kgco2e"]) or "indirect_embedded_kgco2e"
    method_col = _pick(emiss_cols, ["calculation_method", "method"]) or "calculation_method"
    origin_col = _pick(ships_cols, ["origin_country"]) or "origin_country"
    eori_col = _pick(cases_cols, ["importer_eori"]) or "importer_eori"
    year_col = _pick(cases_cols, ["reporting_year"]) or "reporting_year"
    qtr_col = _pick(cases_cols, ["reporting_quarter"]) or "reporting_quarter"

    tenant_flt = "AND c.tenant_id = :tenant_id" if tenant_id else ""
    year_flt = "AND c.{} = :year".format(year_col) if year is not None else ""
    qtr_flt = "AND c.{} = :quarter".format(qtr_col) if quarter is not None else ""

    sql = text(f"""
        SELECT
            COUNT(DISTINCT c.id)                          AS case_count,
            COUNT(DISTINCT s.id)                          AS shipment_count,
            COUNT(gl.id)                                  AS goods_line_count,
            COALESCE(SUM(gl.{mass_col}), 0) / 1000.0     AS total_mass_t,
            COALESCE(SUM(e.{direct_col}), 0)             AS total_direct_kg,
            COALESCE(SUM(e.{indirect_col}), 0)           AS total_indirect_kg,
            COALESCE(SUM(e.{direct_col} + e.{indirect_col}), 0) / 1000.0 AS total_embedded_tco2e,
            e.{method_col}                                AS method,
            s.{origin_col}                                AS origin_country,
            gl.cn_code                                    AS cn_code
            {', ' + extra_select if extra_select else ''}
        FROM cbam.cbam_cases c
        JOIN cbam.cbam_shipments s  ON s.{case_fk} = c.id
        JOIN cbam.cbam_goods_lines gl ON gl.shipment_id = s.id
        LEFT JOIN cbam.cbam_emissions e ON e.goods_line_id = gl.id
        WHERE c.{eori_col} = :importer_eori
          {tenant_flt}
          {year_flt}
          {qtr_flt}
          {extra_where}
        GROUP BY e.{method_col}, s.{origin_col}, gl.cn_code
          {', ' + extra_group if extra_group else ''}
    """)

    params: dict[str, Any] = {"importer_eori": importer_eori}
    if tenant_id:
        params["tenant_id"] = tenant_id
    if year is not None:
        params["year"] = year
    if quarter is not None:
        params["quarter"] = quarter

    rows = conn.execute(sql, params).mappings().all()
    return [dict(r) for r in rows]


# ── 1. Importer KPIs ──────────────────────────────────────────────────────────

def get_importer_kpis(
    conn: Connection,
    *,
    tenant_id: str,
    importer_eori: str,
    year: int | None = None,
    quarter: int | None = None,
    eu_ets_price_eur: Decimal = _D("50"),
) -> ImporterKPIs:
    """Return headline dashboard KPIs for one importer.

    Aggregates across all cases (optionally filtered to a reporting period).
    """
    rows = _run_goods_line_query(
        conn,
        tenant_id=tenant_id,
        importer_eori=importer_eori,
        year=year,
        quarter=quarter,
    )

    total_cases = 0
    total_shipments = 0
    total_goods_lines = 0
    total_mass_t = _ZERO
    total_direct = _ZERO
    total_indirect = _ZERO
    total_embedded = _ZERO
    method_counts: dict[str, int] = {}
    cn_embedded: dict[str, Decimal] = {}
    cn_count: dict[str, int] = {}

    for row in rows:
        total_goods_lines += int(row.get("goods_line_count") or 0)
        mass_t = _D(str(row.get("total_mass_t") or 0))
        direct = _D(str(row.get("total_direct_kg") or 0))
        indirect = _D(str(row.get("total_indirect_kg") or 0))
        embedded = _D(str(row.get("total_embedded_tco2e") or 0))
        total_mass_t += mass_t
        total_direct += direct
        total_indirect += indirect
        total_embedded += embedded

        method = str(row.get("method") or "unknown")
        gl_count = int(row.get("goods_line_count") or 0)
        method_counts[method] = method_counts.get(method, 0) + gl_count

        cn = str(row.get("cn_code") or "unknown")
        cn_embedded[cn] = cn_embedded.get(cn, _ZERO) + embedded
        cn_count[cn] = cn_count.get(cn, 0) + gl_count

    # Derive case/shipment counts from a simpler query
    cases_cols = _cols(conn, "cbam_cases")
    ships_cols = _cols(conn, "cbam_shipments")
    eori_col = _pick(cases_cols, ["importer_eori"]) or "importer_eori"
    year_col = _pick(cases_cols, ["reporting_year"]) or "reporting_year"
    qtr_col = _pick(cases_cols, ["reporting_quarter"]) or "reporting_quarter"
    case_fk = _pick(ships_cols, ["cbam_case_id", "case_id"]) or "cbam_case_id"
    tenant_flt = "AND c.tenant_id = :tenant_id" if tenant_id else ""
    year_flt = f"AND c.{year_col} = :year" if year is not None else ""
    qtr_flt = f"AND c.{qtr_col} = :quarter" if quarter is not None else ""

    cs_params: dict[str, Any] = {"importer_eori": importer_eori}
    if tenant_id:
        cs_params["tenant_id"] = tenant_id
    if year is not None:
        cs_params["year"] = year
    if quarter is not None:
        cs_params["quarter"] = quarter

    cs_row = conn.execute(text(f"""
        SELECT COUNT(DISTINCT c.id) AS c_count, COUNT(DISTINCT s.id) AS s_count
        FROM cbam.cbam_cases c
        LEFT JOIN cbam.cbam_shipments s ON s.{case_fk} = c.id
        WHERE c.{eori_col} = :importer_eori {tenant_flt} {year_flt} {qtr_flt}
    """), cs_params).mappings().one_or_none()

    if cs_row:
        total_cases = int(cs_row["c_count"] or 0)
        total_shipments = int(cs_row["s_count"] or 0)

    certs = math.ceil(float(total_embedded)) if total_embedded > _ZERO else 0
    cost = _D(str(certs)) * eu_ets_price_eur

    top_cn = sorted(cn_embedded.items(), key=lambda x: x[1], reverse=True)[:5]
    top_cn_list = [
        {
            "cn_code": cn,
            "sector": _sector(cn),
            "total_embedded_tco2e": float(emb),
            "goods_line_count": cn_count.get(cn, 0),
        }
        for cn, emb in top_cn
    ]

    return ImporterKPIs(
        importer_eori=importer_eori,
        reporting_year=year,
        reporting_quarter=quarter,
        total_cases=total_cases,
        total_shipments=total_shipments,
        total_goods_lines=total_goods_lines,
        total_net_mass_t=total_mass_t.quantize(_D("0.001")),
        total_direct_kgco2e=total_direct.quantize(_D("0.001")),
        total_indirect_kgco2e=total_indirect.quantize(_D("0.001")),
        total_embedded_tco2e=total_embedded.quantize(_D("0.001")),
        projected_cbam_cost_eur=cost.quantize(_D("0.01")),
        cbam_certificates_required=certs,
        method_breakdown=method_counts,
        top_cn_codes=top_cn_list,
    )


# ── 2. Supplier comparison ────────────────────────────────────────────────────

def get_supplier_comparison(
    conn: Connection,
    *,
    tenant_id: str,
    importer_eori: str,
    cn_code: str,
    year: int | None = None,
    quarter: int | None = None,
    eu_ets_price_eur: Decimal = _D("50"),
) -> SupplierComparisonResult:
    """Rank all suppliers for a CN code by carbon intensity.

    Uses origin_country as the supplier proxy (actual supplier EORI is
    typically absent from invoices; adding a supplier_eori field to the
    case model is a future enhancement).
    """
    cases_cols = _cols(conn, "cbam_cases")
    ships_cols = _cols(conn, "cbam_shipments")
    goods_cols = _cols(conn, "cbam_goods_lines")
    emiss_cols = _cols(conn, "cbam_emissions")

    case_fk = _pick(ships_cols, ["cbam_case_id", "case_id"]) or "cbam_case_id"
    mass_col = _pick(goods_cols, ["net_mass_kg", "quantity"]) or "net_mass_kg"
    direct_col = _pick(emiss_cols, ["direct_emissions_kgco2e", "direct_embedded_kgco2e"]) or "direct_embedded_kgco2e"
    indirect_col = _pick(emiss_cols, ["indirect_emissions_kgco2e", "indirect_embedded_kgco2e"]) or "indirect_embedded_kgco2e"
    origin_col = _pick(ships_cols, ["origin_country"]) or "origin_country"
    eori_col = _pick(cases_cols, ["importer_eori"]) or "importer_eori"
    year_col = _pick(cases_cols, ["reporting_year"]) or "reporting_year"
    qtr_col = _pick(cases_cols, ["reporting_quarter"]) or "reporting_quarter"

    tenant_flt = "AND c.tenant_id = :tenant_id" if tenant_id else ""
    year_flt = f"AND c.{year_col} = :year" if year is not None else ""
    qtr_flt = f"AND c.{qtr_col} = :quarter" if quarter is not None else ""

    sql = text(f"""
        SELECT
            COALESCE(s.{origin_col}, 'UNKNOWN')           AS supplier_id,
            COUNT(gl.id)                                   AS gl_count,
            COALESCE(SUM(gl.{mass_col}), 0) / 1000.0      AS mass_t,
            COALESCE(SUM(e.{direct_col}), 0)              AS direct_kg,
            COALESCE(SUM(e.{indirect_col}), 0)            AS indirect_kg,
            COALESCE(SUM(e.{direct_col} + e.{indirect_col}), 0) / 1000.0 AS embedded_tco2e
        FROM cbam.cbam_cases c
        JOIN cbam.cbam_shipments s  ON s.{case_fk} = c.id
        JOIN cbam.cbam_goods_lines gl ON gl.shipment_id = s.id
        LEFT JOIN cbam.cbam_emissions e ON e.goods_line_id = gl.id
        WHERE c.{eori_col} = :importer_eori
          AND gl.cn_code = :cn_code
          {tenant_flt} {year_flt} {qtr_flt}
        GROUP BY s.{origin_col}
        ORDER BY embedded_tco2e ASC
    """)

    params: dict[str, Any] = {"importer_eori": importer_eori, "cn_code": cn_code}
    if tenant_id:
        params["tenant_id"] = tenant_id
    if year is not None:
        params["year"] = year
    if quarter is not None:
        params["quarter"] = quarter

    rows = conn.execute(sql, params).mappings().all()

    sector = _sector(cn_code)
    entries: list[SupplierEntry] = []

    for rank, row in enumerate(rows, start=1):
        mass_t = _D(str(row["mass_t"] or 0))
        direct = _D(str(row["direct_kg"] or 0))
        indirect = _D(str(row["indirect_kg"] or 0))
        embedded = _D(str(row["embedded_tco2e"] or 0))
        certs = math.ceil(float(embedded)) if embedded > _ZERO else 0
        cost = _D(str(certs)) * eu_ets_price_eur

        if mass_t > _ZERO:
            # SEE: kgCO2e / mass_kg = tCO2e/t
            mass_kg = mass_t * _D("1000")
            see_direct = (direct / mass_kg).quantize(_D("0.000001"))
            see_total = ((direct + indirect) / mass_kg).quantize(_D("0.000001"))
        else:
            see_direct = see_total = _ZERO

        entries.append(SupplierEntry(
            supplier_identifier=str(row["supplier_id"]),
            identifier_type="origin_country",
            cn_code=cn_code,
            sector=sector,
            goods_line_count=int(row["gl_count"] or 0),
            total_net_mass_t=mass_t.quantize(_D("0.001")),
            total_direct_kgco2e=direct.quantize(_D("0.001")),
            total_indirect_kgco2e=indirect.quantize(_D("0.001")),
            total_embedded_tco2e=embedded.quantize(_D("0.001")),
            see_direct_tco2e_per_t=see_direct,
            see_total_tco2e_per_t=see_total,
            projected_cbam_cost_eur=cost.quantize(_D("0.01")),
            carbon_intensity_rank=rank,
        ))

    # Rows already sorted ASC by embedded_tco2e → rank 1 = lowest carbon
    lowest = entries[0].supplier_identifier if entries else None
    highest = entries[-1].supplier_identifier if len(entries) > 1 else None
    saving = (
        (entries[-1].projected_cbam_cost_eur - entries[0].projected_cbam_cost_eur)
        if len(entries) > 1 else _ZERO
    )

    return SupplierComparisonResult(
        cn_code=cn_code,
        sector=sector,
        reporting_year=year,
        reporting_quarter=quarter,
        eu_ets_price_eur=eu_ets_price_eur,
        suppliers=entries,
        lowest_carbon_supplier=lowest,
        highest_carbon_supplier=highest,
        potential_saving_eur=saving.quantize(_D("0.01")),
    )


# ── 3. Country intensity ──────────────────────────────────────────────────────

def get_country_intensity(
    conn: Connection,
    *,
    tenant_id: str,
    importer_eori: str,
    year: int | None = None,
    quarter: int | None = None,
    eu_ets_price_eur: Decimal = _D("50"),
) -> CountryIntensityResult:
    """Rank origin countries by carbon intensity across all CN codes."""
    cases_cols = _cols(conn, "cbam_cases")
    ships_cols = _cols(conn, "cbam_shipments")
    goods_cols = _cols(conn, "cbam_goods_lines")
    emiss_cols = _cols(conn, "cbam_emissions")

    case_fk = _pick(ships_cols, ["cbam_case_id", "case_id"]) or "cbam_case_id"
    mass_col = _pick(goods_cols, ["net_mass_kg", "quantity"]) or "net_mass_kg"
    direct_col = _pick(emiss_cols, ["direct_emissions_kgco2e", "direct_embedded_kgco2e"]) or "direct_embedded_kgco2e"
    indirect_col = _pick(emiss_cols, ["indirect_emissions_kgco2e", "indirect_embedded_kgco2e"]) or "indirect_embedded_kgco2e"
    origin_col = _pick(ships_cols, ["origin_country"]) or "origin_country"
    eori_col = _pick(cases_cols, ["importer_eori"]) or "importer_eori"
    year_col = _pick(cases_cols, ["reporting_year"]) or "reporting_year"
    qtr_col = _pick(cases_cols, ["reporting_quarter"]) or "reporting_quarter"

    tenant_flt = "AND c.tenant_id = :tenant_id" if tenant_id else ""
    year_flt = f"AND c.{year_col} = :year" if year is not None else ""
    qtr_flt = f"AND c.{qtr_col} = :quarter" if quarter is not None else ""

    sql = text(f"""
        SELECT
            COALESCE(s.{origin_col}, 'UNKNOWN') AS country,
            COUNT(gl.id)                          AS gl_count,
            COALESCE(SUM(gl.{mass_col}), 0) / 1000.0 AS mass_t,
            COALESCE(SUM(e.{direct_col} + e.{indirect_col}), 0) / 1000.0 AS embedded_tco2e
        FROM cbam.cbam_cases c
        JOIN cbam.cbam_shipments s   ON s.{case_fk} = c.id
        JOIN cbam.cbam_goods_lines gl ON gl.shipment_id = s.id
        LEFT JOIN cbam.cbam_emissions e ON e.goods_line_id = gl.id
        WHERE c.{eori_col} = :importer_eori
          {tenant_flt} {year_flt} {qtr_flt}
        GROUP BY s.{origin_col}
        ORDER BY embedded_tco2e DESC
    """)

    params: dict[str, Any] = {"importer_eori": importer_eori}
    if tenant_id:
        params["tenant_id"] = tenant_id
    if year is not None:
        params["year"] = year
    if quarter is not None:
        params["quarter"] = quarter

    rows = conn.execute(sql, params).mappings().all()
    entries: list[CountryEntry] = []

    for rank, row in enumerate(rows, start=1):
        mass_t = _D(str(row["mass_t"] or 0))
        embedded = _D(str(row["embedded_tco2e"] or 0))
        mass_kg = mass_t * _D("1000")
        avg_see = (embedded * _D("1000") / mass_kg).quantize(_D("0.000001")) if mass_kg > _ZERO else _ZERO
        certs = math.ceil(float(embedded)) if embedded > _ZERO else 0
        cost = _D(str(certs)) * eu_ets_price_eur

        entries.append(CountryEntry(
            origin_country=str(row["country"]),
            goods_line_count=int(row["gl_count"] or 0),
            total_net_mass_t=mass_t.quantize(_D("0.001")),
            total_embedded_tco2e=embedded.quantize(_D("0.001")),
            avg_see_tco2e_per_t=avg_see,
            projected_cbam_cost_eur=cost.quantize(_D("0.01")),
            carbon_intensity_rank=rank,
        ))

    return CountryIntensityResult(
        reporting_year=year,
        reporting_quarter=quarter,
        eu_ets_price_eur=eu_ets_price_eur,
        countries=entries,
    )


# ── 4. Sector summary ─────────────────────────────────────────────────────────

def get_sector_summary(
    conn: Connection,
    *,
    tenant_id: str,
    importer_eori: str,
    year: int | None = None,
    quarter: int | None = None,
    eu_ets_price_eur: Decimal = _D("50"),
) -> SectorSummaryResult:
    """Break emissions and CBAM cost by CBAM sector."""
    rows = _run_goods_line_query(
        conn,
        tenant_id=tenant_id,
        importer_eori=importer_eori,
        year=year,
        quarter=quarter,
    )

    # Aggregate by sector
    sector_mass: dict[str, Decimal] = {}
    sector_direct: dict[str, Decimal] = {}
    sector_indirect: dict[str, Decimal] = {}
    sector_embedded: dict[str, Decimal] = {}
    sector_gl: dict[str, int] = {}
    sector_cns: dict[str, set] = {}

    for row in rows:
        cn = str(row.get("cn_code") or "")
        sec = _sector(cn)
        gl_count = int(row.get("goods_line_count") or 0)
        mass_t = _D(str(row.get("total_mass_t") or 0))
        direct = _D(str(row.get("total_direct_kg") or 0))
        indirect = _D(str(row.get("total_indirect_kg") or 0))
        embedded = _D(str(row.get("total_embedded_tco2e") or 0))

        sector_mass[sec] = sector_mass.get(sec, _ZERO) + mass_t
        sector_direct[sec] = sector_direct.get(sec, _ZERO) + direct
        sector_indirect[sec] = sector_indirect.get(sec, _ZERO) + indirect
        sector_embedded[sec] = sector_embedded.get(sec, _ZERO) + embedded
        sector_gl[sec] = sector_gl.get(sec, 0) + gl_count
        sector_cns.setdefault(sec, set()).add(cn)

    grand_total = sum(sector_embedded.values(), _ZERO)

    entries: list[SectorEntry] = []
    for sec in sorted(sector_embedded, key=lambda s: sector_embedded[s], reverse=True):
        emb = sector_embedded[sec]
        mass_t = sector_mass[sec]
        mass_kg = mass_t * _D("1000")
        avg_see = (emb * _D("1000") / mass_kg).quantize(_D("0.000001")) if mass_kg > _ZERO else _ZERO
        certs = math.ceil(float(emb)) if emb > _ZERO else 0
        cost = _D(str(certs)) * eu_ets_price_eur
        share = (emb / grand_total * _D("100")).quantize(_D("0.1")) if grand_total > _ZERO else _ZERO

        entries.append(SectorEntry(
            sector=sec,
            cn_codes=sorted(sector_cns.get(sec, set())),
            goods_line_count=sector_gl.get(sec, 0),
            total_net_mass_t=mass_t.quantize(_D("0.001")),
            total_direct_kgco2e=sector_direct.get(sec, _ZERO).quantize(_D("0.001")),
            total_indirect_kgco2e=sector_indirect.get(sec, _ZERO).quantize(_D("0.001")),
            total_embedded_tco2e=emb.quantize(_D("0.001")),
            avg_see_tco2e_per_t=avg_see,
            projected_cbam_cost_eur=cost.quantize(_D("0.01")),
            share_of_total_pct=share,
        ))

    grand_certs = math.ceil(float(grand_total)) if grand_total > _ZERO else 0
    grand_cost = _D(str(grand_certs)) * eu_ets_price_eur

    return SectorSummaryResult(
        reporting_year=year,
        reporting_quarter=quarter,
        eu_ets_price_eur=eu_ets_price_eur,
        total_embedded_tco2e=grand_total.quantize(_D("0.001")),
        total_projected_cost_eur=grand_cost.quantize(_D("0.01")),
        sectors=entries,
    )
