from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from ledger_app.services.cbam_taric import CBAMCodeNotInScope, lookup_sector


def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


def _table_columns(conn: Connection, table_name: str) -> dict[str, dict[str, str | None]]:
    # SQLite: use PRAGMA table_info — information_schema is not available.
    _dialect_name = getattr(getattr(conn, "dialect", None), "name", None)
    if _dialect_name == "sqlite":
        rows = conn.execute(
            text(f"PRAGMA table_info({table_name})")  # noqa: S608
        ).mappings().all()
        if not rows:
            raise HTTPException(status_code=500, detail="Internal server error")
        return {
            row["name"]: {
                "is_nullable": "NO" if row["notnull"] else "YES",
                "column_default": row["dflt_value"],
            }
            for row in rows
        }

    # PostgreSQL (production / Supabase)
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
        raise HTTPException(status_code=500, detail="Internal server error")

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


_ALLOWED_CBAM_TABLES: frozenset[str] = frozenset(
    {"cbam_cases", "cbam_shipments", "cbam_goods_lines", "cbam_emissions"}
)


def _manual_fk_check(conn: Connection, table_name: str, record_id: UUID, label: str) -> None:
    if table_name not in _ALLOWED_CBAM_TABLES:
        raise ValueError(f"Disallowed table reference: {table_name!r}")
    exists = conn.execute(
        text(f"SELECT 1 FROM cbam.{table_name} WHERE id = :id LIMIT 1"),
        {"id": str(record_id)},
    ).scalar_one_or_none()
    if exists is None:
        raise _bad_request(f"Invalid reference: {label} does not exist.")


def _enforce_tenant_id(columns: dict, tenant_id: str) -> None:
    """Raise 401 if the schema has a tenant_id column but no tenant is authenticated."""
    if "tenant_id" in columns and not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing tenant context",
        )


def _require_case_tenant(conn: Connection, case_id: UUID | str, tenant_id: str) -> None:
    """Raise 404 if case_id does not exist or does not belong to the authenticated tenant."""
    if not tenant_id:
        return
    columns = _table_columns(conn, "cbam_cases")
    if "tenant_id" not in columns:
        return
    exists = conn.execute(
        text(
            "SELECT 1 FROM cbam.cbam_cases WHERE id = :id AND tenant_id = :tid LIMIT 1"
        ),
        {"id": str(case_id), "tenant_id": tenant_id},
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


def _resolve_case_for_shipment(conn: Connection, shipment_id: UUID | str) -> str | None:
    """Return the cbam_cases.id for a given shipment (traverses FK to parent case)."""
    cols = _table_columns(conn, "cbam_shipments")
    case_col = _pick_existing(cols, ["cbam_case_id", "case_id"])
    if not case_col:
        return None
    row = conn.execute(
        text(
            f"SELECT {case_col} AS case_id FROM cbam.cbam_shipments WHERE id = :id LIMIT 1"
        ),
        {"id": str(shipment_id)},
    ).mappings().one_or_none()
    return str(row["case_id"]) if row else None


def _resolve_case_for_goods_line(conn: Connection, goods_line_id: UUID | str) -> str | None:
    """Return the cbam_cases.id for a given goods line (goods_line → shipment → case)."""
    cols = _table_columns(conn, "cbam_shipments")
    case_col = _pick_existing(cols, ["cbam_case_id", "case_id"])
    if not case_col:
        return None
    row = conn.execute(
        text(
            f"""
            SELECT s.{case_col} AS case_id
            FROM cbam.cbam_goods_lines gl
            JOIN cbam.cbam_shipments s ON gl.shipment_id = s.id
            WHERE gl.id = :id
            LIMIT 1
            """
        ),
        {"id": str(goods_line_id)},
    ).mappings().one_or_none()
    return str(row["case_id"]) if row else None


def _quarter_from_date(value: date) -> int:
    return ((value.month - 1) // 3) + 1


def _infer_sector_from_cn_code(cn_code: str) -> str:
    """Return the CBAM sector for a CN code using the authoritative TARIC lookup.

    Source: EU Regulation 2023/956, Annex I (OJ L 130, 16.5.2023).
    Raises CBAMCodeNotInScope if the CN code is not covered by CBAM Annex I.
    """
    sector = lookup_sector(cn_code)
    if sector is None:
        raise CBAMCodeNotInScope(cn_code)
    return sector


def _parse_iso_date(value: object) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def _coerce_float(value, field_name: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    if isinstance(value, str):
        stripped = value.strip()
        try:
            return float(stripped)
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid numeric value for {field_name}",
            ) from exc
    raise HTTPException(
        status_code=422,
        detail=f"Invalid numeric value for {field_name}",
    )


def _normalize_line_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


def _normalize_line_mass(value: object) -> str:
    numeric = _coerce_float(value, "line_mass")
    if numeric is None:
        return ""
    # Stable textual numeric representation for duplicate detection.
    return format(Decimal(str(numeric)).normalize(), "f")


def _line_fingerprint(
    cn_code: object,
    description: object,
    mass_value: object,
    quantity_unit: object,
) -> tuple[str, str, str, str]:
    # Deterministic duplicate key per shipment:
    # (cn_code, description, mass, quantity_unit)
    return (
        _normalize_line_text(cn_code),
        _normalize_line_text(description),
        _normalize_line_mass(mass_value),
        _normalize_line_text(quantity_unit),
    )
