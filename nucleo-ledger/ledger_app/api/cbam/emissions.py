from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from . import _shared

router = APIRouter()

# Valid production routes per CBAM sector (EU 2023/1773, Annex VI).
# Derived from cbam_emission_factors.py DefaultSEE table.
_VALID_PRODUCTION_ROUTES: dict[str, frozenset[str]] = {
    "iron_steel":  frozenset({"BF_BOF", "EAF", "DRI_EAF", "WORLD_AVG"}),
    "aluminium":   frozenset({"PRIMARY", "SECONDARY", "WORLD_AVG"}),
    "hydrogen":    frozenset({"SMR", "COAL_GAS", "ELECTRO", "WORLD_AVG"}),
    "cement":      frozenset({"DRY_KILN", "WET_KILN", "WORLD_AVG"}),
    "fertilisers": frozenset({"HABER_BOSCH_NG", "HABER_BOSCH_COAL", "WORLD_AVG"}),
    "electricity": frozenset({"GRID", "RENEWABLE", "WORLD_AVG"}),
}


@router.post("/shipments", status_code=status.HTTP_201_CREATED)
def create_cbam_shipment(payload: _shared.CBAMShipmentCreate):
    with _shared.engine.begin() as conn:
        _shared._manual_fk_check(conn, "cbam_cases", payload.cbam_case_id, "cbam_case_id")
        columns = _shared._table_columns(conn, "cbam_shipments")

        case_fk_column = _shared._pick_existing(columns, ["cbam_case_id", "case_id"])
        if not case_fk_column:
            raise HTTPException(status_code=500, detail="Internal server error")

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

        if _shared._needs_explicit_value(columns, "import_date"):
            insert_payload["import_date"] = date.today()

        created = _shared._insert_returning(conn, "cbam_shipments", insert_payload)
        return created


@router.post("/goods-lines", status_code=status.HTTP_201_CREATED)
def create_cbam_goods_line(payload: _shared.CBAMGoodsLineCreate):
    with _shared.engine.begin() as conn:
        _shared._manual_fk_check(conn, "cbam_shipments", payload.shipment_id, "shipment_id")
        columns = _shared._table_columns(conn, "cbam_goods_lines")

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

        if _shared._needs_explicit_value(columns, "sector"):
            try:
                insert_payload["sector"] = _shared._infer_sector_from_cn_code(payload.cn_code)
            except _shared.CBAMCodeNotInScope as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=str(exc),
                )

        created = _shared._insert_returning(conn, "cbam_goods_lines", insert_payload)
        return created


@router.post("/emissions", status_code=status.HTTP_201_CREATED)
def create_cbam_emissions(payload: _shared.CBAMEmissionsCreate):
    try:
        with _shared.engine.begin() as conn:
            _shared._manual_fk_check(conn, "cbam_goods_lines", payload.goods_line_id, "goods_line_id")

            # ── Production route validation (EU 2023/1773 Annex VI) ───────────
            if payload.production_route:
                gl_sector_row = conn.execute(
                    text(
                        "SELECT cn_code FROM cbam.cbam_goods_lines WHERE id = :id LIMIT 1"
                    ),
                    {"id": str(payload.goods_line_id)},
                ).mappings().one_or_none()
                if gl_sector_row and gl_sector_row.get("cn_code"):
                    try:
                        sector = _shared._infer_sector_from_cn_code(
                            str(gl_sector_row["cn_code"])
                        )
                    except Exception:
                        sector = None
                    if sector and sector in _VALID_PRODUCTION_ROUTES:
                        if payload.production_route not in _VALID_PRODUCTION_ROUTES[sector]:
                            valid = sorted(_VALID_PRODUCTION_ROUTES[sector])
                            raise HTTPException(
                                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail=(
                                    f"Invalid production_route '{payload.production_route}' "
                                    f"for sector '{sector}'. "
                                    f"Valid values: {valid}"
                                ),
                            )

            columns = _shared._table_columns(conn, "cbam_emissions")

            goods_line_fk_column = _shared._pick_existing(columns, ["goods_line_id"])
            if not goods_line_fk_column:
                raise HTTPException(status_code=500, detail="Internal server error")

            direct_col = _shared._pick_existing(columns, ["direct_emissions_kgco2e", "direct_embedded_kgco2e"])
            indirect_col = _shared._pick_existing(columns, ["indirect_emissions_kgco2e", "indirect_embedded_kgco2e"])
            method_col = _shared._pick_existing(columns, ["calculation_method", "method"])

            if not direct_col or not indirect_col or not method_col:
                raise HTTPException(status_code=500, detail="Internal server error")

            # ── Annex VI factor + installation registry integration ────────────
            # Fetch goods_line for cn_code, net mass, and installation_id.
            gl_cols = _shared._table_columns(conn, "cbam_goods_lines")
            cn_col = _shared._pick_existing(gl_cols, ["cn_code"])
            mass_col = _shared._pick_existing(gl_cols, ["net_mass_kg", "quantity"])
            install_col = _shared._pick_existing(gl_cols, ["installation_id"])

            factor_warnings: list[str] = []
            direct_value: Decimal | None = payload.direct_emissions_kgco2e
            indirect_value: Decimal | None = payload.indirect_emissions_kgco2e

            if cn_col and mass_col:
                select_cols = f"{cn_col}, {mass_col}"
                if install_col:
                    select_cols += f", {install_col}"
                gl_row = conn.execute(
                    text(
                        f"SELECT {select_cols} "
                        f"FROM cbam.cbam_goods_lines WHERE id = :id LIMIT 1"
                    ),
                    {"id": str(payload.goods_line_id)},
                ).mappings().one_or_none()

                if gl_row:
                    cn_code = str(gl_row[cn_col]) if gl_row[cn_col] else ""
                    raw_mass = gl_row[mass_col]
                    net_mass_kg: Decimal | None = (
                        Decimal(str(raw_mass)) if raw_mass is not None else None
                    )

                    # ── Installation registry check (EU 2023/956 Art. 10) ─────
                    # Missing/invalid installation_id is reported as a factor
                    # warning here (blocking enforcement is via data quality).
                    if install_col:
                        inst_id = gl_row.get(install_col)
                        ir = _shared.validate_installation_id(
                            installation_id=str(inst_id) if inst_id else None,
                            method=payload.calculation_method.value,
                            goods_line_id=str(payload.goods_line_id),
                        )
                        factor_warnings.extend(ir.missing)
                        factor_warnings.extend(ir.warnings)

                    if (
                        payload.calculation_method == _shared.EmissionsMethod.default
                        and direct_value is None
                        and net_mass_kg is not None
                        and cn_code
                    ):
                        # Auto-compute direct and indirect from Annex VI defaults.
                        computed = _shared.compute_see_from_defaults(
                            cn_code, net_mass_kg, payload.production_route
                        )
                        if computed is not None:
                            direct_value, indirect_value = computed
                        else:
                            factor_warnings.append(
                                f"cbam_factors:no_default_factor:{cn_code} — "
                                f"no Annex VI default available for this CN code; "
                                f"values set to 0 (EU 2023/1773 Annex VI)"
                            )
                            direct_value = Decimal("0")
                            indirect_value = Decimal("0")
                    elif cn_code and net_mass_kg is not None:
                        # Validate submitted values against Annex VI.
                        vr = _shared.validate_against_defaults(
                            cn_code,
                            payload.calculation_method.value,
                            direct_value,
                            net_mass_kg,
                            payload.production_route,
                        )
                        factor_warnings.extend(vr.warnings)

            # Require explicit values for non-default methods or when auto-compute
            # was not possible.
            if direct_value is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        "direct_emissions_kgco2e is required when calculation_method "
                        "is not 'default' or no Annex VI default is available for "
                        "this CN code (EU 2023/1773 Annex VI)"
                    ),
                )
            if indirect_value is None:
                indirect_value = Decimal("0")

            insert_payload: dict[str, object] = {
                "id": str(uuid4()),
                goods_line_fk_column: str(payload.goods_line_id),
                direct_col: direct_value,
                indirect_col: indirect_value,
                method_col: payload.calculation_method.value,
                "version": payload.version,
            }

            created = _shared._insert_returning(conn, "cbam_emissions", insert_payload)
            if factor_warnings:
                created["factor_warnings"] = factor_warnings
            return created
    except IntegrityError:
        allowed = ", ".join(_shared.ALLOWED_EMISSIONS_METHODS)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "invalid_emissions_method",
                "detail": f"method must be one of: {allowed}",
            },
        )
