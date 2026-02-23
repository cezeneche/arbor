from __future__ import annotations

from datetime import date
from decimal import Decimal
from enum import Enum
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

from app.db.session import engine

router = APIRouter(prefix="/cbam", tags=["cbam"])
ALLOWED_EMISSIONS_METHODS = ("actual", "default", "estimated")


class EmissionsMethod(str, Enum):
    actual = "actual"
    default = "default"
    estimated = "estimated"


class CBAMCaseCreate(BaseModel):
    importer_eori: str = Field(..., min_length=1)
    reporting_year: int
    reporting_quarter: int = Field(..., ge=1, le=4)


class CBAMShipmentCreate(BaseModel):
    cbam_case_id: UUID
    origin_country: str | None = None
    customs_procedure: str | None = None


class CBAMGoodsLineCreate(BaseModel):
    shipment_id: UUID
    cn_code: str = Field(..., min_length=1)
    product_description: str | None = None
    net_mass_kg: Decimal = Field(..., gt=0)


class CBAMEmissionsCreate(BaseModel):
    goods_line_id: UUID
    direct_emissions_kgco2e: Decimal
    indirect_emissions_kgco2e: Decimal
    calculation_method: EmissionsMethod
    version: int = Field(..., ge=1)


def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


def _table_columns(conn: Connection, table_name: str) -> dict[str, dict[str, str | None]]:
    rows = conn.execute(
        text(
            """
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'cbam' AND table_name = :table_name
            """
        ),
        {"table_name": table_name},
    ).mappings().all()

    if not rows:
        raise HTTPException(status_code=500, detail=f"Table cbam.{table_name} not found.")

    return {
        row["column_name"]: {
            "is_nullable": row["is_nullable"],
            "column_default": row["column_default"],
        }
        for row in rows
    }


def _pick_existing(columns: dict[str, dict[str, str | None]], options: list[str]) -> str | None:
    for name in options:
        if name in columns:
            return name
    return None


def _needs_explicit_value(columns: dict[str, dict[str, str | None]], name: str) -> bool:
    meta = columns.get(name)
    if not meta:
        return False
    return meta["is_nullable"] == "NO" and meta["column_default"] is None


def _manual_fk_check(conn: Connection, table_name: str, record_id: UUID, label: str) -> None:
    exists = conn.execute(
        text(f"SELECT 1 FROM cbam.{table_name} WHERE id = :id LIMIT 1"),
        {"id": str(record_id)},
    ).scalar_one_or_none()
    if exists is None:
        raise _bad_request(f"Invalid reference: {label} does not exist.")


def _insert_returning(
    conn: Connection,
    table_name: str,
    payload: dict[str, object],
) -> dict[str, object]:
    cols = ", ".join(payload.keys())
    vals = ", ".join(f":{name}" for name in payload)
    row = conn.execute(
        text(f"INSERT INTO cbam.{table_name} ({cols}) VALUES ({vals}) RETURNING *"),
        payload,
    ).mappings().one()
    return dict(row)


@router.post("/cases", status_code=status.HTTP_201_CREATED)
def create_cbam_case(payload: CBAMCaseCreate):
    with engine.begin() as conn:
        columns = _table_columns(conn, "cbam_cases")

        insert_payload: dict[str, object] = {
            "id": str(uuid4()),
            "importer_eori": payload.importer_eori,
            "reporting_year": payload.reporting_year,
            "reporting_quarter": payload.reporting_quarter,
        }

        if "importer_name" in columns:
            insert_payload["importer_name"] = payload.importer_eori
        if "status" in columns:
            insert_payload["status"] = "draft"

        created = _insert_returning(conn, "cbam_cases", insert_payload)
        return created


@router.get("/cases/{case_id}")
def get_cbam_case(case_id: UUID):
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT *
                FROM cbam.cbam_cases
                WHERE id = :id
                LIMIT 1
                """
            ),
            {"id": str(case_id)},
        ).mappings().all()

        if not rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

        return dict(rows[0])


@router.get("/cases")
def list_cbam_cases(
    importer_eori: str | None = None,
    reporting_year: int | None = None,
    reporting_quarter: int | None = Query(default=None, ge=1, le=4),
):
    with engine.begin() as conn:
        columns = _table_columns(conn, "cbam_cases")
        order_by = (
            "created_at DESC"
            if "created_at" in columns
            else "reporting_year DESC, reporting_quarter DESC"
        )

        filters: list[str] = []
        params: dict[str, object] = {}

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
        rows = conn.execute(
            text(
                f"""
                SELECT *
                FROM cbam.cbam_cases
                {where_sql}
                ORDER BY {order_by}
                """
            ),
            params,
        ).mappings().all()

        return [dict(row) for row in rows]


@router.post("/shipments", status_code=status.HTTP_201_CREATED)
def create_cbam_shipment(payload: CBAMShipmentCreate):
    with engine.begin() as conn:
        _manual_fk_check(conn, "cbam_cases", payload.cbam_case_id, "cbam_case_id")
        columns = _table_columns(conn, "cbam_shipments")

        case_fk_column = _pick_existing(columns, ["cbam_case_id", "case_id"])
        if not case_fk_column:
            raise HTTPException(status_code=500, detail="No case FK column found on cbam_shipments.")

        insert_payload: dict[str, object] = {
            "id": str(uuid4()),
            case_fk_column: str(payload.cbam_case_id),
        }

        if "origin_country" in columns:
            insert_payload["origin_country"] = payload.origin_country

        if "customs_procedure" in columns:
            insert_payload["customs_procedure"] = payload.customs_procedure
        elif "incoterm" in columns:
            insert_payload["incoterm"] = payload.customs_procedure
        elif "entry_reference" in columns:
            insert_payload["entry_reference"] = payload.customs_procedure

        if _needs_explicit_value(columns, "import_date"):
            insert_payload["import_date"] = date.today()

        created = _insert_returning(conn, "cbam_shipments", insert_payload)
        return created


@router.post("/goods-lines", status_code=status.HTTP_201_CREATED)
def create_cbam_goods_line(payload: CBAMGoodsLineCreate):
    with engine.begin() as conn:
        _manual_fk_check(conn, "cbam_shipments", payload.shipment_id, "shipment_id")
        columns = _table_columns(conn, "cbam_goods_lines")

        insert_payload: dict[str, object] = {
            "id": str(uuid4()),
            "shipment_id": str(payload.shipment_id),
            "cn_code": payload.cn_code,
        }

        if "product_description" in columns:
            insert_payload["product_description"] = payload.product_description
        elif "description" in columns:
            insert_payload["description"] = payload.product_description

        if "net_mass_kg" in columns:
            insert_payload["net_mass_kg"] = payload.net_mass_kg
        elif "quantity" in columns:
            insert_payload["quantity"] = payload.net_mass_kg
            if "quantity_unit" in columns:
                insert_payload["quantity_unit"] = "kg"

        if _needs_explicit_value(columns, "sector"):
            insert_payload["sector"] = "iron_steel"

        created = _insert_returning(conn, "cbam_goods_lines", insert_payload)
        return created


@router.post("/emissions", status_code=status.HTTP_201_CREATED)
def create_cbam_emissions(payload: CBAMEmissionsCreate):
    try:
        with engine.begin() as conn:
            _manual_fk_check(conn, "cbam_goods_lines", payload.goods_line_id, "goods_line_id")
            columns = _table_columns(conn, "cbam_emissions")

            goods_line_fk_column = _pick_existing(columns, ["goods_line_id"])
            if not goods_line_fk_column:
                raise HTTPException(status_code=500, detail="No goods line FK column found on cbam_emissions.")

            direct_col = _pick_existing(columns, ["direct_emissions_kgco2e", "direct_embedded_kgco2e"])
            indirect_col = _pick_existing(columns, ["indirect_emissions_kgco2e", "indirect_embedded_kgco2e"])
            method_col = _pick_existing(columns, ["calculation_method", "method"])

            if not direct_col or not indirect_col or not method_col:
                raise HTTPException(status_code=500, detail="Expected emissions columns not found on cbam_emissions.")

            insert_payload: dict[str, object] = {
                "id": str(uuid4()),
                goods_line_fk_column: str(payload.goods_line_id),
                direct_col: payload.direct_emissions_kgco2e,
                indirect_col: payload.indirect_emissions_kgco2e,
                method_col: payload.calculation_method.value,
                "version": payload.version,
            }

            created = _insert_returning(conn, "cbam_emissions", insert_payload)
            return created
    except IntegrityError:
        allowed = ", ".join(ALLOWED_EMISSIONS_METHODS)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "invalid_emissions_method",
                "detail": f"method must be one of: {allowed}",
            },
        )


@router.get("/cases/{case_id}/summary")
def get_cbam_case_summary(case_id: UUID):
    with engine.begin() as conn:
        _manual_fk_check(conn, "cbam_cases", case_id, "case_id")

        shipments_cols = _table_columns(conn, "cbam_shipments")
        goods_cols = _table_columns(conn, "cbam_goods_lines")
        emissions_cols = _table_columns(conn, "cbam_emissions")

        case_fk_column = _pick_existing(shipments_cols, ["cbam_case_id", "case_id"])
        if not case_fk_column:
            raise HTTPException(status_code=500, detail="No case FK column found on cbam_shipments.")

        net_mass_col = _pick_existing(goods_cols, ["net_mass_kg", "quantity"])
        if not net_mass_col:
            raise HTTPException(status_code=500, detail="No goods mass column found on cbam_goods_lines.")

        direct_col = _pick_existing(emissions_cols, ["direct_emissions_kgco2e", "direct_embedded_kgco2e"])
        indirect_col = _pick_existing(emissions_cols, ["indirect_emissions_kgco2e", "indirect_embedded_kgco2e"])
        if not direct_col or not indirect_col:
            raise HTTPException(status_code=500, detail="Expected emissions columns not found on cbam_emissions.")

        summary = conn.execute(
            text(
                f"""
                WITH latest_emissions AS (
                    SELECT e.goods_line_id, e.{direct_col} AS direct_emissions, e.{indirect_col} AS indirect_emissions
                    FROM cbam.cbam_emissions e
                    INNER JOIN (
                        SELECT goods_line_id, MAX(version) AS max_version
                        FROM cbam.cbam_emissions
                        GROUP BY goods_line_id
                    ) mx
                        ON mx.goods_line_id = e.goods_line_id
                       AND mx.max_version = e.version
                )
                SELECT
                    COUNT(gl.id) AS total_goods_lines,
                    COALESCE(SUM(gl.{net_mass_col}), 0) AS total_net_mass_kg,
                    COALESCE(SUM(le.direct_emissions), 0) AS total_direct_emissions_kgco2e,
                    COALESCE(SUM(le.indirect_emissions), 0) AS total_indirect_emissions_kgco2e
                FROM cbam.cbam_goods_lines gl
                INNER JOIN cbam.cbam_shipments s ON s.id = gl.shipment_id
                LEFT JOIN latest_emissions le ON le.goods_line_id = gl.id
                WHERE s.{case_fk_column} = :case_id
                """
            ),
            {"case_id": str(case_id)},
        ).mappings().one()

        direct = Decimal(summary["total_direct_emissions_kgco2e"] or 0)
        indirect = Decimal(summary["total_indirect_emissions_kgco2e"] or 0)

        return {
            "case_id": str(case_id),
            "total_goods_lines": int(summary["total_goods_lines"] or 0),
            "total_net_mass_kg": Decimal(summary["total_net_mass_kg"] or 0),
            "total_direct_emissions_kgco2e": direct,
            "total_indirect_emissions_kgco2e": indirect,
            "total_embedded_emissions_kgco2e": direct + indirect,
        }
