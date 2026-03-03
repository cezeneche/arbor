from __future__ import annotations

import os
from datetime import datetime
from decimal import Decimal

from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")

import ledger_app.api.cbam as cbam_api
import ledger_app.api.report_package as report_package_api


class _Result:
    def __init__(self, rows=None, scalar=None):
        self._rows = rows or []
        self._scalar = scalar

    def mappings(self):
        return self

    def all(self):
        return self._rows

    def one(self):
        if not self._rows:
            raise AssertionError("Expected one row, found none")
        return self._rows[0]

    def one_or_none(self):
        return self._rows[0] if self._rows else None

    def scalar_one_or_none(self):
        return self._scalar


class FakeConnection:
    def __init__(self):
        self.cases: dict[str, dict] = {}
        self.shipments: dict[str, dict] = {}
        self.goods_lines: dict[str, dict] = {}
        self.emissions: dict[str, dict] = {}

        self._columns = {
            "cbam_cases": [
                ("id", "NO", None),
                ("importer_name", "NO", None),
                ("importer_eori", "NO", None),
                ("reporting_year", "NO", None),
                ("reporting_quarter", "NO", None),
                ("status", "NO", "'draft'::text"),
                ("created_at", "NO", "now()"),
                ("updated_at", "NO", "now()"),
            ],
            "cbam_shipments": [
                ("id", "NO", None),
                ("case_id", "NO", None),
                ("import_date", "NO", None),
                ("entry_reference", "YES", None),
                ("incoterm", "YES", None),
                ("origin_country", "YES", None),
                ("created_at", "NO", "now()"),
            ],
            "cbam_goods_lines": [
                ("id", "NO", None),
                ("shipment_id", "NO", None),
                ("cn_code", "NO", None),
                ("sector", "NO", None),
                ("description", "YES", None),
                ("quantity", "NO", None),
                ("quantity_unit", "NO", None),
                ("installation_name", "YES", None),
                ("installation_id", "YES", None),
                ("created_at", "NO", "now()"),
            ],
            "cbam_emissions": [
                ("id", "NO", None),
                ("goods_line_id", "NO", None),
                ("method", "NO", None),
                ("direct_embedded_kgco2e", "NO", None),
                ("indirect_embedded_kgco2e", "YES", None),
                ("data_quality_score", "YES", None),
                ("notes", "YES", None),
                ("version", "NO", None),
                ("created_at", "NO", "now()"),
            ],
        }

    def execute(self, statement, params=None):
        params = params or {}
        sql = str(statement)

        if "FROM information_schema.columns" in sql:
            table_name = params["table_name"]
            rows = [
                {"column_name": c, "is_nullable": n, "column_default": d}
                for c, n, d in self._columns[table_name]
            ]
            return _Result(rows=rows)

        if sql.startswith("SELECT 1 FROM cbam.") and "WHERE id = :id" in sql:
            if "cbam_cases" in sql:
                exists = 1 if params["id"] in self.cases else None
            elif "cbam_shipments" in sql:
                exists = 1 if params["id"] in self.shipments else None
            elif "cbam_goods_lines" in sql:
                exists = 1 if params["id"] in self.goods_lines else None
            else:
                raise AssertionError(f"Unexpected FK check SQL: {sql}")
            return _Result(scalar=exists)

        # Goods-line factor lookup: SELECT cn_code, <mass_col> FROM cbam.cbam_goods_lines WHERE id = :id LIMIT 1
        if (
            "FROM cbam.cbam_goods_lines" in sql
            and "WHERE id = :id" in sql
            and "LIMIT 1" in sql
            and "SELECT *" not in sql
            and "SELECT 1" not in sql
        ):
            row = self.goods_lines.get(params["id"])
            return _Result(rows=[row] if row else [])

        if "SELECT *" in sql and "FROM cbam.cbam_cases" in sql and "WHERE id = :id" in sql:
            row = self.cases.get(params["id"])
            return _Result(rows=[row] if row else [])

        if "SELECT *" in sql and "FROM cbam.cbam_shipments" in sql and "WHERE case_id = :case_id" in sql:
            rows = [r for r in self.shipments.values() if r.get("case_id") == params.get("case_id")]
            rows = sorted(rows, key=lambda r: (r.get("created_at"), r.get("id")))
            return _Result(rows=rows)

        if "SELECT *" in sql and "FROM cbam.cbam_goods_lines" in sql and "WHERE shipment_id = :shipment_id" in sql:
            rows = [r for r in self.goods_lines.values() if r.get("shipment_id") == params.get("shipment_id")]
            rows = sorted(rows, key=lambda r: (r.get("created_at"), r.get("id")))
            return _Result(rows=rows)

        if "SELECT *" in sql and "FROM cbam.cbam_emissions" in sql and "WHERE goods_line_id = :goods_line_id" in sql:
            rows = [r for r in self.emissions.values() if r.get("goods_line_id") == params.get("goods_line_id")]
            rows = sorted(
                rows,
                key=lambda r: (int(r.get("version") or 0), r.get("created_at"), r.get("id")),
                reverse=True,
            )
            if "LIMIT 1" in sql:
                rows = rows[:1]
            return _Result(rows=rows)

        if "SELECT *" in sql and "FROM cbam.cbam_cases" in sql and "ORDER BY" in sql:
            rows = list(self.cases.values())
            if "importer_eori = :importer_eori" in sql:
                rows = [r for r in rows if r.get("importer_eori") == params.get("importer_eori")]
            if "reporting_year = :reporting_year" in sql:
                rows = [r for r in rows if r.get("reporting_year") == params.get("reporting_year")]
            if "reporting_quarter = :reporting_quarter" in sql:
                rows = [r for r in rows if r.get("reporting_quarter") == params.get("reporting_quarter")]

            if "created_at DESC" in sql:
                rows = sorted(rows, key=lambda r: r.get("created_at"), reverse=True)
            else:
                rows = sorted(
                    rows,
                    key=lambda r: (r.get("reporting_year", 0), r.get("reporting_quarter", 0)),
                    reverse=True,
                )
            return _Result(rows=rows)

        if sql.startswith("INSERT INTO cbam.") and "RETURNING *" in sql:
            table = sql.split("INSERT INTO cbam.", 1)[1].split(" ", 1)[0]
            row = dict(params)
            now = datetime.utcnow()

            if table == "cbam_cases":
                row.setdefault("status", "draft")
                row.setdefault("created_at", now)
                row.setdefault("updated_at", now)
                self.cases[row["id"]] = row
            elif table == "cbam_shipments":
                row.setdefault("created_at", now)
                self.shipments[row["id"]] = row
            elif table == "cbam_goods_lines":
                row.setdefault("created_at", now)
                self.goods_lines[row["id"]] = row
            elif table == "cbam_emissions":
                row.setdefault("created_at", now)
                self.emissions[row["id"]] = row
            else:
                raise AssertionError(f"Unexpected insert table: {table}")

            return _Result(rows=[row])

        if "WITH latest_emissions AS" in sql and "AS goods_line_id" in sql:
            # Per-goods-line query from POST /cases/{id}/liability
            case_id = params["case_id"]
            shipment_ids = [s["id"] for s in self.shipments.values() if s.get("case_id") == case_id]
            goods = sorted(
                [g for g in self.goods_lines.values() if g.get("shipment_id") in shipment_ids],
                key=lambda g: g.get("id", ""),
            )
            rows = []
            for g in goods:
                goods_em = [e for e in self.emissions.values() if e.get("goods_line_id") == g["id"]]
                if goods_em:
                    latest = sorted(goods_em, key=lambda x: int(x.get("version") or 0), reverse=True)[0]
                    direct = latest.get("direct_embedded_kgco2e", 0)
                    indirect = latest.get("indirect_embedded_kgco2e", 0)
                else:
                    direct = indirect = 0
                rows.append({
                    "goods_line_id": g["id"],
                    "cn_code": g.get("cn_code", ""),
                    "net_mass_kg": g.get("quantity", 0),
                    "direct_kgco2e": direct,
                    "indirect_kgco2e": indirect,
                })
            return _Result(rows=rows)

        if "WITH latest_emissions AS" in sql:
            case_id = params["case_id"]
            shipment_ids = [s["id"] for s in self.shipments.values() if s.get("case_id") == case_id]
            goods = [g for g in self.goods_lines.values() if g.get("shipment_id") in shipment_ids]

            total_mass = Decimal("0")
            total_direct = Decimal("0")
            total_indirect = Decimal("0")

            for g in goods:
                total_mass += Decimal(g.get("quantity") or 0)
                goods_em = [e for e in self.emissions.values() if e.get("goods_line_id") == g["id"]]
                if goods_em:
                    latest = sorted(goods_em, key=lambda x: int(x.get("version") or 0), reverse=True)[0]
                    total_direct += Decimal(latest.get("direct_embedded_kgco2e") or 0)
                    total_indirect += Decimal(latest.get("indirect_embedded_kgco2e") or 0)

            return _Result(
                rows=[
                    {
                        "total_goods_lines": len(goods),
                        "total_net_mass_kg": total_mass,
                        "total_direct_emissions_kgco2e": total_direct,
                        "total_indirect_emissions_kgco2e": total_indirect,
                    }
                ]
            )

        raise AssertionError(f"Unexpected SQL in test: {sql}")


class FakeTx:
    def __init__(self, conn: FakeConnection):
        self.conn = conn

    def __enter__(self):
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeEngine:
    def __init__(self, conn: FakeConnection):
        self.conn = conn

    def begin(self):
        return FakeTx(self.conn)


def _client_with_fake_engine() -> tuple[TestClient, FakeConnection]:
    conn = FakeConnection()
    cbam_api.engine = FakeEngine(conn)

    app = FastAPI()
    app.include_router(cbam_api.router, prefix="/api")
    app.include_router(report_package_api.router, prefix="/api")
    return TestClient(app), conn
