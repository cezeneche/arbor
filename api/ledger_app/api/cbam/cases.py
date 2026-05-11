from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import bindparam, text

from ledger_app.services.cbam_data_quality import evaluate_cbam_data_quality
from . import _shared


class CBAMCasePatch(BaseModel):
    actor_name:       str | None = None
    field_changes:    dict[str, Any] | None = None
    # cbam_cases
    importer_eori:    str | None = None
    importer_name:    str | None = None
    # cbam_shipments (first shipment)
    origin_country:   str | None = None
    entry_reference:  str | None = None
    incoterm:         str | None = None
    # cbam_goods_lines (first goods line)
    cn_code:          str | None = None
    net_mass_kg:      float | None = None
    installation_id:  str | None = None
    sector:           str | None = None   # DB key e.g. "iron_steel"
    # cbam_emissions (latest record for first goods line)
    emissions_method: str | None = None   # "actual" | "estimated" | "default"
    direct_kgco2e:    float | None = None  # in kgCO2e


# Rough Annex VI SEE defaults (tCO2e/t) — same constants used by the case detail page.
# Used as fallback when no actual emissions record exists for a goods line.
_ROUGH_SEE_TCO2_PER_T: dict[str, Decimal] = {
    "iron_steel":  Decimal("1.8"),
    "aluminium":   Decimal("2.0"),
    "cement":      Decimal("0.9"),
    "fertilisers": Decimal("2.5"),
    "hydrogen":    Decimal("9.5"),
    "electricity": Decimal("0.4"),
}

# UK ETS Q1 2027 quarterly average — mirrors public_tools.py constant.
# Used as the rate for rough estimates so the home page matches the case detail page.
_UK_ETS_RATE_PLACEHOLDER = Decimal("52.40")


def _enrich_cases_with_liability(
    conn: Any,
    items: list[dict],
) -> None:
    """Augment case dicts in-place with origin_country, sector, estimated_liability_gbp, total_net_mass_kg.

    Runs two batch queries (not N per case). Safe to call with an empty list.
    When actual emissions exist in cbam_emissions, uses the CBAM-adjusted rate from
    cbam_uk_rates. When no emissions record exists but goods lines with mass are present,
    falls back to rough SEE × UK ETS rate so the home page always shows a non-null
    planning estimate consistent with the case detail page.
    """
    if not items:
        return

    case_ids = [str(item["id"]) for item in items]

    shipments_cols = _shared._table_columns(conn, "cbam_shipments")
    emissions_cols = _shared._table_columns(conn, "cbam_emissions")
    goods_cols     = _shared._table_columns(conn, "cbam_goods_lines")

    case_fk_col = _shared._pick_existing(shipments_cols, ["cbam_case_id", "case_id", "cbam_case_uuid"])
    direct_col   = _shared._pick_existing(
        emissions_cols, ["direct_kgco2e", "direct_emissions_kgco2e", "direct_embedded_kgco2e"]
    )
    mass_col     = _shared._pick_existing(goods_cols, ["net_mass_kg", "quantity"])
    if not case_fk_col or not direct_col:
        return

    # ── Query 1: latest direct emissions + net mass per (case_id, sector) ────
    emission_rows = conn.execute(
        text(
            f"""
            WITH latest_emissions AS (
                SELECT e.goods_line_id, e.{direct_col} AS direct_kgco2e
                FROM cbam.cbam_emissions e
                INNER JOIN (
                    SELECT goods_line_id, MAX(version) AS max_ver
                    FROM cbam.cbam_emissions
                    GROUP BY goods_line_id
                ) mx ON mx.goods_line_id = e.goods_line_id
                    AND mx.max_ver = e.version
            )
            SELECT
                s.{case_fk_col}                              AS case_id,
                gl.sector,
                COALESCE(SUM(le.direct_kgco2e), 0)           AS sector_kgco2e,
                COALESCE(SUM(gl.{mass_col if mass_col else '0'}), 0) AS sector_net_mass_kg
            FROM cbam.cbam_shipments s
            JOIN cbam.cbam_goods_lines gl ON gl.shipment_id = s.id
            LEFT JOIN latest_emissions le ON le.goods_line_id = gl.id
            WHERE s.{case_fk_col} IN :case_ids
            GROUP BY s.{case_fk_col}, gl.sector
            """
        ).bindparams(bindparam("case_ids", expanding=True)),
        {"case_ids": case_ids},
    ).mappings().all()

    # ── Query 2: first non-null origin_country per case ───────────────────────
    origin_rows = conn.execute(
        text(
            f"""
            SELECT DISTINCT ON ({case_fk_col})
                {case_fk_col} AS case_id,
                origin_country
            FROM cbam.cbam_shipments
            WHERE {case_fk_col} IN :case_ids
              AND origin_country IS NOT NULL
            ORDER BY {case_fk_col}, created_at ASC
            """
        ).bindparams(bindparam("case_ids", expanding=True)),
        {"case_ids": case_ids},
    ).mappings().all()

    # ── Aggregate in Python ───────────────────────────────────────────────────
    # Each entry: (sector, kgco2e, mass_kg) — mass_kg used for rough-estimate fallback
    emissions_by_case: dict[str, list[tuple[str, Decimal, Decimal]]] = {}
    mass_by_case: dict[str, Decimal] = {}
    for row in emission_rows:
        cid = str(row["case_id"])
        mass_kg = Decimal(str(row["sector_net_mass_kg"] or 0))
        emissions_by_case.setdefault(cid, []).append(
            (str(row["sector"]), Decimal(str(row["sector_kgco2e"])), mass_kg)
        )
        mass_by_case[cid] = mass_by_case.get(cid, Decimal("0")) + mass_kg

    origin_by_case: dict[str, str] = {
        str(r["case_id"]): str(r["origin_country"]) for r in origin_rows
    }

    # Lazy import — cbam_uk_rates lives in app.services (consolidated service)
    from app.services.cbam_uk_rates import get_uk_cbam_rate  # noqa: PLC0415

    for item in items:
        cid = str(item["id"])
        item["origin_country"] = origin_by_case.get(cid)
        item["total_net_mass_kg"] = float(mass_by_case.get(cid, Decimal("0"))) or None

        sector_rows = emissions_by_case.get(cid, [])
        if not sector_rows:
            item["sector"] = None
            item["estimated_liability_gbp"] = None
            continue

        # Primary sector: the one with the most kgco2e (or most mass if all zero)
        primary_sector = max(sector_rows, key=lambda t: (t[1], t[2]))[0]
        item["sector"] = primary_sector

        year = int(item.get("reporting_year") or 0)
        quarter = int(item.get("reporting_quarter") or 1) if year > 2027 else None

        total_liability = Decimal("0")
        for sector, kgco2e, mass_kg in sector_rows:
            effective_kgco2e = kgco2e
            if effective_kgco2e == 0 and mass_kg > 0 and sector in _ROUGH_SEE_TCO2_PER_T:
                # No actual emissions recorded — use rough Annex VI default × mass
                see = _ROUGH_SEE_TCO2_PER_T[sector]
                effective_kgco2e = (mass_kg / Decimal("1000")) * see * Decimal("1000")

            if effective_kgco2e <= 0:
                continue

            cbam_rate = get_uk_cbam_rate(sector, year, quarter)
            # Fall back to raw ETS rate when no CBAM-adjusted rate is published yet,
            # matching the planning estimate shown on the case detail page.
            rate = cbam_rate if cbam_rate is not None else _UK_ETS_RATE_PLACEHOLDER
            total_liability += (effective_kgco2e / Decimal("1000") * rate).quantize(
                Decimal("0.01")
            )

        item["estimated_liability_gbp"] = float(total_liability) if total_liability > 0 else None

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
    actor_sub: str = getattr(getattr(request.state, "auth_context", None), "sub", "system")
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
            insert_payload["importer_name"] = payload.importer_name
        if "status" in columns:
            insert_payload["status"] = "draft"
        if "tenant_id" in columns:
            insert_payload["tenant_id"] = tenant_id
        if "jurisdiction" in columns:
            insert_payload["jurisdiction"] = payload.jurisdiction.value
        if "carbon_price_paid_third_country_eur" in columns and payload.carbon_price_paid_third_country_eur is not None:
            insert_payload["carbon_price_paid_third_country_eur"] = str(
                payload.carbon_price_paid_third_country_eur
            )

        created = _shared._insert_returning(conn, "cbam_cases", insert_payload)

    _shared._write_audit_event(
        str(created["id"]),
        "case_created",
        {
            "importer_eori": payload.importer_eori,
            "importer_name": payload.importer_name,
            "reporting_year": payload.reporting_year,
            "reporting_quarter": payload.reporting_quarter,
        },
        actor_sub=actor_sub,
        tenant_id=tenant_id,
    )
    return created


@router.get("/cases/{case_id}")
def get_cbam_case(request: Request, case_id: str):
    from uuid import UUID as _UUID  # noqa: PLC0415
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

        # Include shipments + goods lines so the case detail page can render them
        try:
            case_uuid = _UUID(str(case_id))
            shipments_payload = _shared._build_case_shipments_payload(conn, case_uuid)
            # Flatten to a simple list of goods-line dicts (with emissions merged in)
            goods_lines: list[dict] = []
            for ship_entry in shipments_payload:
                shipment = ship_entry.get("shipment") or {}
                for gl_entry in ship_entry.get("goods_lines") or []:
                    gl: dict = dict(gl_entry.get("goods_line") or {})
                    em = gl_entry.get("latest_emissions") or {}
                    # Merge key emission fields onto the goods line for UI convenience
                    gl["direct_kgco2e"]   = em.get("direct_kgco2e") or em.get("direct_embedded_kgco2e")
                    gl["indirect_kgco2e"] = em.get("indirect_kgco2e") or em.get("indirect_embedded_kgco2e")
                    gl["method"]          = em.get("method")
                    gl["origin_country"]  = shipment.get("origin_country")
                    gl["import_date"]     = shipment.get("import_date")
                    goods_lines.append(gl)
            result["goods_lines"] = goods_lines
            result["shipments"]   = [e.get("shipment") or {} for e in shipments_payload]

            # ── Data quality / open gaps ──────────────────────────────────────
            # Re-run the same check used during extraction so the case page
            # always shows the current state of the data, not a stale snapshot.
            try:
                case_row_dq: dict[str, object] = {
                    "id":                result.get("id"),
                    "importer_eori":     result.get("importer_eori"),
                    "reporting_year":    result.get("reporting_year"),
                    "reporting_quarter": result.get("reporting_quarter"),
                }
                shipments_dq = []
                for ship_entry in shipments_payload:
                    shipment_dq = dict(ship_entry.get("shipment") or {})
                    goods_dq    = ship_entry.get("goods_lines") or []
                    shipments_dq.append({"shipment": shipment_dq, "goods_lines": goods_dq})
                dq = evaluate_cbam_data_quality(case_row_dq, shipments_dq)
                result["open_gaps"] = dq
            except Exception:
                result["open_gaps"] = None

        except Exception:
            result.setdefault("shipments", [])
            result.setdefault("goods_lines", [])
            result.setdefault("open_gaps", None)

        return result


@router.patch("/cases/{case_id}", status_code=status.HTTP_200_OK)
def patch_cbam_case(request: Request, case_id: str, payload: CBAMCasePatch):
    """Persist editable field changes to cbam_cases / shipments / goods_lines / emissions
    and write an HMAC-chained audit event so every change is version-controlled."""
    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")
    actor_sub: str = getattr(getattr(request.state, "auth_context", None), "sub", "system")

    with _shared.engine.begin() as conn:
        # ── Verify case ───────────────────────────────────────────────────────
        columns = _shared._table_columns(conn, "cbam_cases")
        _shared._enforce_tenant_id(columns, tenant_id)
        _shared.set_tenant_context(conn, tenant_id)
        tenant_filter = "AND tenant_id = :tenant_id" if "tenant_id" in columns else ""

        if not conn.execute(
            text(f"SELECT 1 FROM cbam.cbam_cases WHERE id = :id {tenant_filter} LIMIT 1"),
            {"id": str(case_id), "tenant_id": tenant_id},
        ).fetchone():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

        # ── cbam_cases ────────────────────────────────────────────────────────
        case_set: list[str] = []
        case_p: dict[str, object] = {"id": str(case_id), "tenant_id": tenant_id}

        if payload.importer_eori is not None and "importer_eori" in columns:
            case_set.append("importer_eori = :importer_eori")
            case_p["importer_eori"] = _shared.encrypt_field(payload.importer_eori)
        if payload.importer_name is not None and "importer_name" in columns:
            case_set.append("importer_name = :importer_name")
            case_p["importer_name"] = payload.importer_name
        if "updated_at" in columns:
            case_set.append("updated_at = NOW()")

        if case_set:
            conn.execute(
                text(f"UPDATE cbam.cbam_cases SET {', '.join(case_set)} WHERE id = :id {tenant_filter}"),
                case_p,
            )

        # ── Locate first shipment (FK col name varies by migration) ──────────
        ship_cols = _shared._table_columns(conn, "cbam_shipments")
        case_fk   = _shared._pick_existing(ship_cols, ["cbam_case_id", "case_id", "cbam_case_uuid"])

        if not case_fk:
            # No FK found — persist case-only fields and return
            _shared._write_audit_event(
                case_id, "case_fields_updated",
                {"actor_name": payload.actor_name or actor_sub, "field_changes": payload.field_changes or {}},
                actor_sub=actor_sub,
                tenant_id=tenant_id,
            )
            return {"status": "ok", "case_id": case_id}

        ship_row = conn.execute(
            text(f"SELECT id FROM cbam.cbam_shipments WHERE {case_fk} = :cid ORDER BY id ASC LIMIT 1"),
            {"cid": str(case_id)},
        ).fetchone()

        if ship_row:
            ship_id = str(ship_row[0])

            # ── cbam_shipments ────────────────────────────────────────────────
            ship_set: list[str] = []
            ship_p: dict[str, object] = {"id": ship_id}
            if payload.origin_country is not None and "origin_country" in ship_cols:
                ship_set.append("origin_country = :origin_country")
                ship_p["origin_country"] = payload.origin_country
            if payload.entry_reference is not None and "entry_reference" in ship_cols:
                ship_set.append("entry_reference = :entry_reference")
                ship_p["entry_reference"] = payload.entry_reference
            if payload.incoterm is not None and "incoterm" in ship_cols:
                ship_set.append("incoterm = :incoterm")
                ship_p["incoterm"] = payload.incoterm
            if ship_set:
                conn.execute(text(f"UPDATE cbam.cbam_shipments SET {', '.join(ship_set)} WHERE id = :id"), ship_p)

            # ── Locate first goods line ───────────────────────────────────────
            gl_cols = _shared._table_columns(conn, "cbam_goods_lines")
            gl_row  = conn.execute(
                text("SELECT id FROM cbam.cbam_goods_lines WHERE shipment_id = :sid ORDER BY id ASC LIMIT 1"),
                {"sid": ship_id},
            ).fetchone()

            if gl_row:
                gl_id = str(gl_row[0])

                # ── cbam_goods_lines ──────────────────────────────────────────
                gl_set: list[str] = []
                gl_p: dict[str, object] = {"id": gl_id}
                mass_col = _shared._pick_existing(gl_cols, ["net_mass_kg", "quantity"])
                if payload.cn_code is not None and "cn_code" in gl_cols:
                    gl_set.append("cn_code = :cn_code");       gl_p["cn_code"] = payload.cn_code
                if payload.net_mass_kg is not None and mass_col:
                    gl_set.append(f"{mass_col} = :net_mass_kg"); gl_p["net_mass_kg"] = payload.net_mass_kg
                if payload.installation_id is not None and "installation_id" in gl_cols:
                    gl_set.append("installation_id = :installation_id"); gl_p["installation_id"] = payload.installation_id
                if payload.sector is not None and "sector" in gl_cols:
                    gl_set.append("sector = :sector");         gl_p["sector"] = payload.sector
                if gl_set:
                    conn.execute(text(f"UPDATE cbam.cbam_goods_lines SET {', '.join(gl_set)} WHERE id = :id"), gl_p)

                # ── cbam_emissions ────────────────────────────────────────────
                if payload.emissions_method is not None or payload.direct_kgco2e is not None:
                    em_cols    = _shared._table_columns(conn, "cbam_emissions")
                    direct_col = _shared._pick_existing(em_cols, ["direct_kgco2e", "direct_emissions_kgco2e", "direct_embedded_kgco2e"])
                    em_row     = conn.execute(
                        text("SELECT id FROM cbam.cbam_emissions WHERE goods_line_id = :gl ORDER BY version DESC LIMIT 1"),
                        {"gl": gl_id},
                    ).fetchone()

                    em_set: list[str] = []
                    em_p: dict[str, object] = {}
                    if payload.emissions_method is not None and "method" in em_cols:
                        em_set.append("method = :method"); em_p["method"] = payload.emissions_method
                    if payload.direct_kgco2e is not None and direct_col:
                        em_set.append(f"{direct_col} = :direct_kgco2e"); em_p["direct_kgco2e"] = payload.direct_kgco2e

                    if em_set and em_row:
                        em_p["id"] = str(em_row[0])
                        conn.execute(text(f"UPDATE cbam.cbam_emissions SET {', '.join(em_set)} WHERE id = :id"), em_p)

    actor_display = payload.actor_name or actor_sub
    _shared._write_audit_event(
        case_id,
        "case_fields_updated",
        {"actor_name": actor_display, "field_changes": payload.field_changes or {}},
        actor_sub=actor_sub,
        tenant_id=tenant_id,
    )
    return {"status": "ok", "case_id": case_id}


@router.delete("/cases/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cbam_case(request: Request, case_id: str):
    """Permanently delete a CBAM case and all associated data.

    The cbam_shipments → cbam_goods_lines → cbam_emissions chain is covered by
    ON DELETE CASCADE in migration 001. Snapshots have no FK constraint so are
    deleted explicitly first.
    """
    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")
    with _shared.engine.begin() as conn:
        columns = _shared._table_columns(conn, "cbam_cases")
        _shared._enforce_tenant_id(columns, tenant_id)
        _shared.set_tenant_context(conn, tenant_id)
        tenant_filter = "AND tenant_id = :tenant_id" if "tenant_id" in columns else ""

        rows = conn.execute(
            text(f"SELECT id FROM cbam.cbam_cases WHERE id = :id {tenant_filter} LIMIT 1"),
            {"id": str(case_id), "tenant_id": tenant_id},
        ).mappings().all()

        if not rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

        # Delete snapshots (no FK cascade on this table)
        try:
            conn.execute(
                text("DELETE FROM cbam.cbam_snapshots WHERE case_id = :cid"),
                {"cid": str(case_id)},
            )
        except Exception:
            pass  # table may not exist in all environments

        # Delete the case — cascade removes shipments → goods_lines → emissions
        conn.execute(
            text(f"DELETE FROM cbam.cbam_cases WHERE id = :id {tenant_filter}"),
            {"id": str(case_id), "tenant_id": tenant_id},
        )


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

        items = []
        for row in rows:
            r = dict(row)
            if "importer_eori" in r:
                r["importer_eori"] = _shared.decrypt_field(r["importer_eori"])
            items.append(r)

        _enrich_cases_with_liability(conn, items)
        return {"items": items, "offset": offset, "limit": limit, "count": len(items)}
