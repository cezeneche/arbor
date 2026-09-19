from __future__ import annotations

import os
from datetime import datetime
from decimal import Decimal

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")

import ledger_app.api.cbam as cbam_api
import ledger_app.api.report_package as report_package_api
from shared_auth import get_auth_context


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
                # Migration 007 columns
                ("factor_table_version", "YES", None),
                ("production_route", "YES", None),
            ],
            "cbam_users": [
                ("id", "NO", None),
                ("sub", "NO", None),
                ("email", "YES", None),
                ("display_name", "YES", None),
                ("tenant_id", "NO", "''"),
                ("role", "NO", "'importer'::text"),
                ("is_active", "NO", "true"),
                ("created_at", "NO", "now()"),
                ("updated_at", "NO", "now()"),
                ("last_seen_at", "YES", None),
            ],
            "cbam_emission_factors": [
                ("id", "NO", None),
                ("cn8_prefix", "NO", None),
                ("sector", "NO", None),
                ("production_route", "YES", None),
                ("direct_tco2e_per_t", "NO", None),
                ("indirect_tco2e_per_t", "NO", None),
                ("description", "YES", None),
                ("source_ref", "NO", None),
                ("table_version", "NO", "'2023'::text"),
                ("effective_from", "NO", None),
                ("effective_to", "YES", None),
                ("created_at", "NO", "now()"),
                ("seeded_by", "YES", None),
            ],
            "cbam_electricity_factors": [
                ("id", "NO", None),
                ("country_iso2", "NO", None),
                ("tco2e_per_mwh", "NO", None),
                ("source_ref", "NO", None),
                ("table_version", "NO", "'2023'::text"),
                ("effective_from", "NO", None),
                ("effective_to", "YES", None),
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

        # _require_case_tenant: SELECT 1 FROM cbam.cbam_cases WHERE id = :id AND tenant_id = :tenant_id LIMIT 1
        # (checked before the generic FK-check block below, since this is a more specific match)
        if "FROM cbam.cbam_cases" in sql and "tenant_id = :tenant_id" in sql:
            row = self.cases.get(params.get("id"))
            exists = 1 if row and row.get("tenant_id") == params.get("tenant_id") else None
            return _Result(scalar=exists)

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

        # _resolve_case_for_shipment: SELECT <col> AS case_id FROM cbam.cbam_shipments WHERE id = :id LIMIT 1
        if (
            "AS case_id" in sql
            and "FROM cbam.cbam_shipments" in sql
            and "JOIN" not in sql
        ):
            row = self.shipments.get(params.get("id"))
            case_id = row.get("case_id") if row else None
            return _Result(rows=[{"case_id": case_id}] if case_id else [])

        # _resolve_case_for_goods_line: SELECT s.<col> AS case_id FROM cbam.cbam_goods_lines gl
        # JOIN cbam.cbam_shipments s ON gl.shipment_id = s.id WHERE gl.id = :id
        if (
            "AS case_id" in sql
            and "FROM cbam.cbam_goods_lines" in sql
            and "JOIN cbam.cbam_shipments" in sql
        ):
            gl = self.goods_lines.get(params.get("id"))
            ship = self.shipments.get(gl.get("shipment_id")) if gl else None
            case_id = ship.get("case_id") if ship else None
            return _Result(rows=[{"case_id": case_id}] if case_id else [])

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

        # Duplicate-case check: always report no conflict in tests.
        if (
            "SELECT id FROM cbam.cbam_cases" in sql
            and "importer_eori = :importer_eori" in sql
            and "id != :stub_id" in sql
        ):
            return _Result(rows=[])

        # UPDATE cbam_cases (status, processing_stage, fields, etc.)
        # Handles both parametrised values and SQL-literal values such as
        # `SET status = 'error'` that _mark_error writes as a string literal.
        if "UPDATE cbam.cbam_cases SET" in sql and "WHERE id = :id" in sql:
            case_id = params.get("id")
            if case_id and case_id in self.cases:
                for k, v in params.items():
                    if k != "id":
                        self.cases[case_id][k] = v
                # Extract SQL-literal assignments: col = 'value'
                import re as _re
                for m in _re.finditer(r"(\w+)\s*=\s*'([^']*)'", sql):
                    col, val = m.group(1), m.group(2)
                    if col not in ("WHERE", "id"):
                        self.cases[case_id].setdefault(col, val)
                        self.cases[case_id][col] = val
            return _Result(rows=[])

        # DELETE cbam_cases (conflict resolution path)
        if "DELETE FROM cbam.cbam_cases WHERE id = :id" in sql:
            self.cases.pop(params.get("id"), None)
            return _Result(rows=[])

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


_SNAPSHOT_DIR: str | None = None


def _isolate_snapshot_store() -> None:
    """Send audit-chain snapshots to a temp directory for the process.

    One directory per process rather than per client: the chain is keyed by
    case id and every fake connection mints fresh ones, so there is nothing to
    collide.
    """
    global _SNAPSHOT_DIR
    if _SNAPSHOT_DIR is None:
        import tempfile  # noqa: PLC0415

        _SNAPSHOT_DIR = tempfile.mkdtemp(prefix="nucleos-test-snapshots-")
    os.environ["SNAPSHOT_STORE_BACKEND"] = "filesystem"
    os.environ["SNAPSHOT_STORE_DIR"] = _SNAPSHOT_DIR


def _client_with_fake_engine() -> tuple[TestClient, FakeConnection]:
    from shared_auth.testing import make_test_token

    conn = FakeConnection()
    cbam_api.engine = FakeEngine(conn)

    # The CBAM tables are faked, so the audit-chain snapshots have to be too.
    # get_snapshot_store() picks the SQL backend whenever DATABASE_URL is not
    # SQLite, which means that with TEST_DATABASE_URL set — the only way to run
    # the RLS suite — these tests wrote snapshots for cases that exist only in
    # the fake connection, and Postgres rejected them on the foreign key. The
    # report route correctly turns a snapshot failure into a 503, so six tests
    # failed for a reason that had nothing to do with what they test.
    _isolate_snapshot_store()

    token = make_test_token(scopes=["cbam:read", "cbam:write", "narrative:run"])

    # Mounted as production mounts them, behind get_auth_context. Without it the
    # tenant on request.state was empty, and any route that reads the real engine
    # (insights binds it at import) ran its queries unscoped.
    app = FastAPI()
    app.include_router(cbam_api.router, prefix="/api", dependencies=[Depends(get_auth_context)])
    app.include_router(
        report_package_api.router, prefix="/api", dependencies=[Depends(get_auth_context)]
    )
    return TestClient(app, headers={"Authorization": f"Bearer {token}"}), conn
