from __future__ import annotations

import os
import re
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

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


def test_cbam_flow_and_summary():
    client, _ = _client_with_fake_engine()

    case_res = client.post(
        "/api/cbam/cases",
        json={
            "importer_eori": "GB123456789",
            "reporting_year": 2025,
            "reporting_quarter": 1,
        },
    )
    assert case_res.status_code == 201
    case_id = case_res.json()["id"]

    shipment_res = client.post(
        "/api/cbam/shipments",
        json={
            "cbam_case_id": case_id,
            "origin_country": "CN",
            "customs_procedure": "40",
        },
    )
    assert shipment_res.status_code == 201
    shipment_id = shipment_res.json()["id"]

    goods_res = client.post(
        "/api/cbam/goods-lines",
        json={
            "shipment_id": shipment_id,
            "cn_code": "720711",
            "product_description": "Hot rolled steel coil",
            "net_mass_kg": 10000,
        },
    )
    assert goods_res.status_code == 201
    goods_line_id = goods_res.json()["id"]

    em_res = client.post(
        "/api/cbam/emissions",
        json={
            "goods_line_id": goods_line_id,
            "direct_emissions_kgco2e": 50000,
            "indirect_emissions_kgco2e": 10000,
            "calculation_method": "actual",
            "version": 1,
        },
    )
    assert em_res.status_code == 201

    summary_res = client.get(f"/api/cbam/cases/{case_id}/summary")
    assert summary_res.status_code == 200
    body = summary_res.json()
    assert body["case_id"] == case_id
    assert body["total_goods_lines"] == 1
    assert body["total_net_mass_kg"] == 10000
    assert body["total_direct_emissions_kgco2e"] == 50000
    assert body["total_indirect_emissions_kgco2e"] == 10000
    assert body["total_embedded_emissions_kgco2e"] == 60000


def test_invalid_fk_returns_400():
    client, _ = _client_with_fake_engine()

    missing_case = client.post(
        "/api/cbam/shipments",
        json={
            "cbam_case_id": str(UUID("00000000-0000-0000-0000-000000000001")),
            "origin_country": "CN",
            "customs_procedure": "40",
        },
    )
    assert missing_case.status_code == 400

    missing_shipment = client.post(
        "/api/cbam/goods-lines",
        json={
            "shipment_id": str(UUID("00000000-0000-0000-0000-000000000002")),
            "cn_code": "720711",
            "product_description": "Hot rolled steel coil",
            "net_mass_kg": 10000,
        },
    )
    assert missing_shipment.status_code == 400

    missing_goods_line = client.post(
        "/api/cbam/emissions",
        json={
            "goods_line_id": str(UUID("00000000-0000-0000-0000-000000000003")),
            "direct_emissions_kgco2e": 50000,
            "indirect_emissions_kgco2e": 10000,
            "calculation_method": "actual",
            "version": 1,
        },
    )
    assert missing_goods_line.status_code == 400

    missing_summary = client.get("/api/cbam/cases/00000000-0000-0000-0000-000000000004/summary")
    assert missing_summary.status_code == 400


def test_invalid_emissions_method_validation_or_db_error():
    client, _ = _client_with_fake_engine()

    response = client.post(
        "/api/cbam/emissions",
        json={
            "goods_line_id": str(UUID("00000000-0000-0000-0000-000000000003")),
            "direct_emissions_kgco2e": 50000,
            "indirect_emissions_kgco2e": 10000,
            "calculation_method": "actual_data",
            "version": 1,
        },
    )

    assert response.status_code in (422, 400)
    if response.status_code == 400:
        assert response.json() == {
            "detail": {
                "error": "invalid_emissions_method",
                "detail": "method must be one of: actual, default, estimated",
            }
        }


def test_get_case_by_id_returns_200_with_same_id():
    client, _ = _client_with_fake_engine()

    create_res = client.post(
        "/api/cbam/cases",
        json={
            "importer_eori": "GB123456789",
            "reporting_year": 2025,
            "reporting_quarter": 1,
        },
    )
    assert create_res.status_code == 201
    case_id = create_res.json()["id"]

    get_res = client.get(f"/api/cbam/cases/{case_id}")
    assert get_res.status_code == 200
    body = get_res.json()
    assert body["id"] == case_id


def test_get_unknown_case_returns_404():
    client, _ = _client_with_fake_engine()

    response = client.get("/api/cbam/cases/00000000-0000-0000-0000-000000000111")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_report_package_has_required_keys():
    client, _ = _client_with_fake_engine()

    case_res = client.post(
        "/api/cbam/cases",
        json={
            "importer_eori": "GB999888777",
            "reporting_year": 2025,
            "reporting_quarter": 1,
        },
    )
    assert case_res.status_code == 201
    case_id = case_res.json()["id"]

    shipment_res = client.post(
        "/api/cbam/shipments",
        json={
            "cbam_case_id": case_id,
            "origin_country": "CN",
            "customs_procedure": "40",
        },
    )
    assert shipment_res.status_code == 201
    shipment_id = shipment_res.json()["id"]

    goods_res = client.post(
        "/api/cbam/goods-lines",
        json={
            "shipment_id": shipment_id,
            "cn_code": "720711",
            "product_description": "Hot rolled steel coil",
            "net_mass_kg": 10000,
        },
    )
    assert goods_res.status_code == 201

    report_res = client.get(f"/api/cbam/cases/{case_id}/report-package")
    assert report_res.status_code == 200
    body = report_res.json()

    assert body["type"] == "cbam_report_package_v1"
    assert "generated_at" in body
    assert "case" in body
    assert "shipments" in body
    assert "summary" in body
    assert "data_quality" in body
    assert "audit" in body
    assert "missing" in body["data_quality"]
    assert "warnings" in body["data_quality"]
    assert isinstance(body["shipments"], list)
    assert len(body["data_quality"]["warnings"]) >= 1
    assert re.fullmatch(r"[0-9a-f]{64}", str(body["audit"]["payload_hash"]))
    assert re.fullmatch(r"[0-9a-f]{64}", str(body["audit"]["snapshot_hash"]))


def test_report_package_unknown_case_returns_404():
    client, _ = _client_with_fake_engine()
    response = client.get("/api/cbam/cases/00000000-0000-0000-0000-000000000222/report-package")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_data_quality_blocking_when_emissions_missing():
    client, _ = _client_with_fake_engine()

    case_res = client.post(
        "/api/cbam/cases",
        json={
            "importer_eori": "GB777888999",
            "reporting_year": 2025,
            "reporting_quarter": 1,
        },
    )
    assert case_res.status_code == 201
    case_id = case_res.json()["id"]

    shipment_res = client.post(
        "/api/cbam/shipments",
        json={
            "cbam_case_id": case_id,
            "origin_country": "CN",
            "customs_procedure": "40",
        },
    )
    assert shipment_res.status_code == 201
    shipment_id = shipment_res.json()["id"]

    goods_res = client.post(
        "/api/cbam/goods-lines",
        json={
            "shipment_id": shipment_id,
            "cn_code": "720711",
            "product_description": "Hot rolled steel coil",
            "net_mass_kg": 10000,
        },
    )
    assert goods_res.status_code == 201

    summary_res = client.get(f"/api/cbam/cases/{case_id}/summary")
    assert summary_res.status_code == 200
    dq = summary_res.json()["data_quality"]
    assert dq["blocking"] is True
    assert any("missing_emissions" in entry for entry in dq["missing"])
    assert isinstance(dq["score"], float)


def test_data_quality_blocking_when_origin_country_missing():
    client, _ = _client_with_fake_engine()

    case_res = client.post(
        "/api/cbam/cases",
        json={
            "importer_eori": "GB444555666",
            "reporting_year": 2025,
            "reporting_quarter": 1,
        },
    )
    assert case_res.status_code == 201
    case_id = case_res.json()["id"]

    shipment_res = client.post(
        "/api/cbam/shipments",
        json={
            "cbam_case_id": case_id,
            "origin_country": None,
            "customs_procedure": "40",
        },
    )
    assert shipment_res.status_code == 201
    shipment_id = shipment_res.json()["id"]

    goods_res = client.post(
        "/api/cbam/goods-lines",
        json={
            "shipment_id": shipment_id,
            "cn_code": "720711",
            "product_description": "Hot rolled steel coil",
            "net_mass_kg": 10000,
        },
    )
    assert goods_res.status_code == 201
    goods_line_id = goods_res.json()["id"]

    emissions_res = client.post(
        "/api/cbam/emissions",
        json={
            "goods_line_id": goods_line_id,
            "direct_emissions_kgco2e": 50000,
            "indirect_emissions_kgco2e": 10000,
            "calculation_method": "actual",
            "version": 1,
        },
    )
    assert emissions_res.status_code == 201

    report_res = client.get(f"/api/cbam/cases/{case_id}/report-package")
    assert report_res.status_code == 200
    dq = report_res.json()["data_quality"]
    assert dq["blocking"] is True
    assert any("origin_country_missing" in entry for entry in dq["missing"])


def test_data_quality_warning_when_installation_id_missing():
    client, _ = _client_with_fake_engine()

    case_res = client.post(
        "/api/cbam/cases",
        json={
            "importer_eori": "GB333222111",
            "reporting_year": 2025,
            "reporting_quarter": 1,
        },
    )
    assert case_res.status_code == 201
    case_id = case_res.json()["id"]

    shipment_res = client.post(
        "/api/cbam/shipments",
        json={
            "cbam_case_id": case_id,
            "origin_country": "CN",
            "customs_procedure": "40",
        },
    )
    assert shipment_res.status_code == 201
    shipment_id = shipment_res.json()["id"]

    goods_res = client.post(
        "/api/cbam/goods-lines",
        json={
            "shipment_id": shipment_id,
            "cn_code": "720711",
            "product_description": "Hot rolled steel coil",
            "net_mass_kg": 10000,
        },
    )
    assert goods_res.status_code == 201
    goods_line_id = goods_res.json()["id"]

    emissions_res = client.post(
        "/api/cbam/emissions",
        json={
            "goods_line_id": goods_line_id,
            "direct_emissions_kgco2e": 50000,
            "indirect_emissions_kgco2e": 10000,
            "calculation_method": "actual",
            "version": 1,
        },
    )
    assert emissions_res.status_code == 201

    report_res = client.get(f"/api/cbam/cases/{case_id}/report-package")
    assert report_res.status_code == 200
    dq = report_res.json()["data_quality"]
    assert dq["blocking"] is False
    assert any("installation_id_missing" in entry for entry in dq["warnings"])
    assert all("method_not_actual" not in entry for entry in dq["warnings"])
    assert isinstance(dq["score"], float)


def test_legacy_report_package_route_delegates_to_cbam_package():
    client, _ = _client_with_fake_engine()

    case_res = client.post(
        "/api/cbam/cases",
        json={
            "importer_eori": "GB111222333",
            "reporting_year": 2025,
            "reporting_quarter": 1,
        },
    )
    assert case_res.status_code == 201
    case_id = case_res.json()["id"]

    legacy_res = client.get(f"/api/cases/{case_id}/report-package")
    cbam_res = client.get(f"/api/cbam/cases/{case_id}/report-package")

    assert legacy_res.status_code == 200
    assert cbam_res.status_code == 200

    legacy_payload = legacy_res.json()
    cbam_payload = cbam_res.json()

    assert legacy_payload["type"] == "cbam_report_package_v1"
    assert legacy_payload["case"]["id"] == case_id

    legacy_payload.pop("generated_at", None)
    cbam_payload.pop("generated_at", None)
    legacy_payload.pop("audit", None)
    cbam_payload.pop("audit", None)
    assert legacy_payload == cbam_payload


def test_legacy_report_package_route_returns_404_when_case_missing():
    client, _ = _client_with_fake_engine()
    response = client.get("/api/cases/00000000-0000-0000-0000-000000000333/report-package")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_draft_from_parsed_invoice_reuses_case_and_shipment_without_duplicates():
    client, conn = _client_with_fake_engine()
    payload = {
        "importer": {"name": "Acme Imports Ltd", "eori": "GB123456789"},
        "invoice": {
            "invoice_number": "INV-2025-001",
            "invoice_date": "2025-01-15",
            "origin_country": "CN",
            "incoterm": "FOB",
            "entry_reference": "ER-001",
        },
        "lines": [
            {
                "cn_code": "720711",
                "description": "Hot rolled steel coil",
                "quantity": 10000,
                "quantity_unit": "kg",
                "net_mass_kg": 10000,
            }
        ],
        "emissions": {
            "method": "actual",
            "direct_embedded_kgco2e": 50000,
            "indirect_embedded_kgco2e": 10000,
        },
    }

    first = client.post("/api/cbam/drafts/from-parsed-invoice", json=payload)
    assert first.status_code == 201
    first_body = first.json()
    assert len(first_body["goods_line_ids"]) >= 1
    assert len(first_body["emissions_ids"]) >= 1

    second = client.post("/api/cbam/drafts/from-parsed-invoice", json=payload)
    assert second.status_code == 201
    second_body = second.json()

    assert second_body["case_id"] == first_body["case_id"]
    assert second_body["shipment_id"] == first_body["shipment_id"]
    assert second_body["goods_line_ids"] == first_body["goods_line_ids"]
    assert second_body["emissions_ids"] == first_body["emissions_ids"]
    assert len(conn.cases) == 1
    assert len(conn.shipments) == 1
    assert len(conn.goods_lines) == 1
    assert len(conn.emissions) == 1


def test_draft_from_parsed_invoice_invalid_method_returns_422():
    client, _ = _client_with_fake_engine()
    response = client.post(
        "/api/cbam/drafts/from-parsed-invoice",
        json={
            "importer": {"name": "Acme Imports Ltd", "eori": "GB123456789"},
            "invoice": {"invoice_number": "INV-2025-001", "invoice_date": "2025-01-15"},
            "lines": [{"cn_code": "720711"}],
            "emissions": {
                "method": "actual_data",
                "direct_embedded_kgco2e": 50000,
                "indirect_embedded_kgco2e": 10000,
            },
        },
    )
    assert response.status_code == 422
