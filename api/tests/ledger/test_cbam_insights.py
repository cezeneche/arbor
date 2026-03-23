"""Tests for CBAM Sourcing Insights endpoints and service layer.

Coverage
--------
1. API routing — all 4 GET endpoints return 200 with correct shape
2. Missing importer_eori → 422
3. Service logic — KPI aggregation, supplier ranking, country ranking,
   sector breakdown — using a mock connection that returns pre-built rows
4. Empty datasets return valid zero-value responses
5. Supplier comparison rankings (lowest/highest carbon, potential saving)
6. Sector share_of_total_pct sums to ~100
"""

from __future__ import annotations

import os
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")

import ledger_app.api.cbam as cbam_api
from ledger_app.testing import _client_with_fake_engine
from ledger_app.services.cbam_insights_service import (
    get_importer_kpis,
    get_supplier_comparison,
    get_country_intensity,
    get_sector_summary,
    ImporterKPIs,
    SupplierComparisonResult,
    CountryIntensityResult,
    SectorSummaryResult,
)

_D = Decimal
_EORI = "GB123456789000"
_CN_CEMENT = "25232900"
_CN_STEEL = "72081000"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mock_kpis(**kwargs) -> ImporterKPIs:
    defaults = dict(
        importer_eori=_EORI,
        reporting_year=2024,
        reporting_quarter=1,
        total_cases=3,
        total_shipments=5,
        total_goods_lines=8,
        total_net_mass_t=_D("100.000"),
        total_direct_kgco2e=_D("81000.000"),
        total_indirect_kgco2e=_D("6000.000"),
        total_embedded_tco2e=_D("87.000"),
        projected_cbam_cost_eur=_D("4350.00"),
        cbam_certificates_required=87,
        method_breakdown={"default": 6, "actual": 2},
        top_cn_codes=[{"cn_code": _CN_CEMENT, "sector": "cement",
                       "total_embedded_tco2e": 81.0, "goods_line_count": 4}],
    )
    defaults.update(kwargs)
    return ImporterKPIs(**defaults)


def _mock_supplier_result(**kwargs) -> SupplierComparisonResult:
    from ledger_app.services.cbam_insights_service import SupplierEntry
    entries = [
        SupplierEntry(
            supplier_identifier="CN",
            identifier_type="origin_country",
            cn_code=_CN_CEMENT,
            sector="cement",
            goods_line_count=3,
            total_net_mass_t=_D("60.000"),
            total_direct_kgco2e=_D("45000.000"),
            total_indirect_kgco2e=_D("3600.000"),
            total_embedded_tco2e=_D("48.600"),
            see_direct_tco2e_per_t=_D("0.750000"),
            see_total_tco2e_per_t=_D("0.810000"),
            projected_cbam_cost_eur=_D("2450.00"),
            carbon_intensity_rank=1,
        ),
        SupplierEntry(
            supplier_identifier="TR",
            identifier_type="origin_country",
            cn_code=_CN_CEMENT,
            sector="cement",
            goods_line_count=2,
            total_net_mass_t=_D("40.000"),
            total_direct_kgco2e=_D("40000.000"),
            total_indirect_kgco2e=_D("2400.000"),
            total_embedded_tco2e=_D("42.400"),
            see_direct_tco2e_per_t=_D("1.000000"),
            see_total_tco2e_per_t=_D("1.060000"),
            projected_cbam_cost_eur=_D("2120.00"),
            carbon_intensity_rank=2,
        ),
    ]
    defaults = dict(
        cn_code=_CN_CEMENT,
        sector="cement",
        reporting_year=2024,
        reporting_quarter=1,
        eu_ets_price_eur=_D("50"),
        suppliers=entries,
        lowest_carbon_supplier="CN",
        highest_carbon_supplier="TR",
        potential_saving_eur=_D("330.00"),
    )
    defaults.update(kwargs)
    return SupplierComparisonResult(**defaults)


# ── API layer tests ───────────────────────────────────────────────────────────

class TestInsightsKPIsEndpoint:
    def setup_method(self):
        self.client, _ = _client_with_fake_engine()

    def test_kpis_returns_200(self, monkeypatch):
        monkeypatch.setattr(
            "ledger_app.api.cbam.insights.get_importer_kpis",
            lambda conn, **kw: _mock_kpis(),
        )
        resp = self.client.get(f"/api/cbam/insights/kpis?importer_eori={_EORI}")
        assert resp.status_code == 200

    def test_kpis_has_required_fields(self, monkeypatch):
        monkeypatch.setattr(
            "ledger_app.api.cbam.insights.get_importer_kpis",
            lambda conn, **kw: _mock_kpis(),
        )
        body = self.client.get(f"/api/cbam/insights/kpis?importer_eori={_EORI}").json()
        for key in (
            "importer_eori", "total_cases", "total_shipments", "total_goods_lines",
            "total_net_mass_t", "total_embedded_tco2e", "projected_cbam_cost_eur",
            "cbam_certificates_required", "method_breakdown", "top_cn_codes",
        ):
            assert key in body, f"Missing field: {key}"

    def test_kpis_missing_eori_returns_422(self):
        resp = self.client.get("/api/cbam/insights/kpis")
        assert resp.status_code == 422

    def test_kpis_empty_eori_returns_422(self, monkeypatch):
        monkeypatch.setattr(
            "ledger_app.api.cbam.insights.get_importer_kpis",
            lambda conn, **kw: _mock_kpis(),
        )
        resp = self.client.get("/api/cbam/insights/kpis?importer_eori=")
        assert resp.status_code == 422

    def test_kpis_projected_cost_is_numeric(self, monkeypatch):
        monkeypatch.setattr(
            "ledger_app.api.cbam.insights.get_importer_kpis",
            lambda conn, **kw: _mock_kpis(),
        )
        body = self.client.get(f"/api/cbam/insights/kpis?importer_eori={_EORI}").json()
        assert isinstance(body["projected_cbam_cost_eur"], (int, float))
        assert body["projected_cbam_cost_eur"] >= 0

    def test_kpis_with_year_and_quarter(self, monkeypatch):
        calls = []
        def mock_kpis(conn, **kw):
            calls.append(kw)
            return _mock_kpis()
        monkeypatch.setattr("ledger_app.api.cbam.insights.get_importer_kpis", mock_kpis)
        self.client.get(
            f"/api/cbam/insights/kpis?importer_eori={_EORI}&reporting_year=2024&reporting_quarter=2"
        )
        assert calls[0]["year"] == 2024
        assert calls[0]["quarter"] == 2

    def test_kpis_eu_ets_price_passed_through(self, monkeypatch):
        calls = []
        def mock_kpis(conn, **kw):
            calls.append(kw)
            return _mock_kpis()
        monkeypatch.setattr("ledger_app.api.cbam.insights.get_importer_kpis", mock_kpis)
        self.client.get(f"/api/cbam/insights/kpis?importer_eori={_EORI}&eu_ets_price_eur=75.5")
        assert float(calls[0]["eu_ets_price_eur"]) == pytest.approx(75.5)


class TestSupplierComparisonEndpoint:
    def setup_method(self):
        self.client, _ = _client_with_fake_engine()

    def test_supplier_comparison_returns_200(self, monkeypatch):
        monkeypatch.setattr(
            "ledger_app.api.cbam.insights.get_supplier_comparison",
            lambda conn, **kw: _mock_supplier_result(),
        )
        resp = self.client.get(
            f"/api/cbam/insights/supplier-comparison?importer_eori={_EORI}&cn_code={_CN_CEMENT}"
        )
        assert resp.status_code == 200

    def test_supplier_comparison_has_suppliers_list(self, monkeypatch):
        monkeypatch.setattr(
            "ledger_app.api.cbam.insights.get_supplier_comparison",
            lambda conn, **kw: _mock_supplier_result(),
        )
        body = self.client.get(
            f"/api/cbam/insights/supplier-comparison?importer_eori={_EORI}&cn_code={_CN_CEMENT}"
        ).json()
        assert "suppliers" in body
        assert isinstance(body["suppliers"], list)

    def test_supplier_comparison_has_ranking_fields(self, monkeypatch):
        monkeypatch.setattr(
            "ledger_app.api.cbam.insights.get_supplier_comparison",
            lambda conn, **kw: _mock_supplier_result(),
        )
        body = self.client.get(
            f"/api/cbam/insights/supplier-comparison?importer_eori={_EORI}&cn_code={_CN_CEMENT}"
        ).json()
        assert "lowest_carbon_supplier" in body
        assert "highest_carbon_supplier" in body
        assert "potential_saving_eur" in body

    def test_supplier_comparison_missing_cn_returns_422(self, monkeypatch):
        monkeypatch.setattr(
            "ledger_app.api.cbam.insights.get_supplier_comparison",
            lambda conn, **kw: _mock_supplier_result(),
        )
        resp = self.client.get(
            f"/api/cbam/insights/supplier-comparison?importer_eori={_EORI}"
        )
        assert resp.status_code == 422

    def test_supplier_each_entry_has_see(self, monkeypatch):
        monkeypatch.setattr(
            "ledger_app.api.cbam.insights.get_supplier_comparison",
            lambda conn, **kw: _mock_supplier_result(),
        )
        body = self.client.get(
            f"/api/cbam/insights/supplier-comparison?importer_eori={_EORI}&cn_code={_CN_CEMENT}"
        ).json()
        for entry in body["suppliers"]:
            assert "see_direct_tco2e_per_t" in entry
            assert "see_total_tco2e_per_t" in entry
            assert "carbon_intensity_rank" in entry


class TestCountryIntensityEndpoint:
    def setup_method(self):
        self.client, _ = _client_with_fake_engine()

    def _mock_country(self):
        from ledger_app.services.cbam_insights_service import CountryEntry
        return CountryIntensityResult(
            reporting_year=2024,
            reporting_quarter=1,
            eu_ets_price_eur=_D("50"),
            countries=[
                CountryEntry("CN", 4, _D("80.000"), _D("75.000"), _D("0.937500"), _D("3800.00"), 1),
                CountryEntry("TR", 2, _D("30.000"), _D("20.000"), _D("0.666667"), _D("1000.00"), 2),
            ],
        )

    def test_country_intensity_returns_200(self, monkeypatch):
        monkeypatch.setattr(
            "ledger_app.api.cbam.insights.get_country_intensity",
            lambda conn, **kw: self._mock_country(),
        )
        resp = self.client.get(f"/api/cbam/insights/country-intensity?importer_eori={_EORI}")
        assert resp.status_code == 200

    def test_country_intensity_has_countries(self, monkeypatch):
        monkeypatch.setattr(
            "ledger_app.api.cbam.insights.get_country_intensity",
            lambda conn, **kw: self._mock_country(),
        )
        body = self.client.get(f"/api/cbam/insights/country-intensity?importer_eori={_EORI}").json()
        assert "countries" in body
        assert len(body["countries"]) == 2

    def test_country_intensity_entries_have_rank(self, monkeypatch):
        monkeypatch.setattr(
            "ledger_app.api.cbam.insights.get_country_intensity",
            lambda conn, **kw: self._mock_country(),
        )
        body = self.client.get(f"/api/cbam/insights/country-intensity?importer_eori={_EORI}").json()
        ranks = [c["carbon_intensity_rank"] for c in body["countries"]]
        assert ranks == sorted(ranks)   # ascending rank order matches response order


class TestSectorSummaryEndpoint:
    def setup_method(self):
        self.client, _ = _client_with_fake_engine()

    def _mock_sector(self):
        from ledger_app.services.cbam_insights_service import SectorEntry
        cement = SectorEntry(
            sector="cement",
            cn_codes=[_CN_CEMENT],
            goods_line_count=5,
            total_net_mass_t=_D("100.000"),
            total_direct_kgco2e=_D("81000.000"),
            total_indirect_kgco2e=_D("6000.000"),
            total_embedded_tco2e=_D("87.000"),
            avg_see_tco2e_per_t=_D("0.870000"),
            projected_cbam_cost_eur=_D("4350.00"),
            share_of_total_pct=_D("72.5"),
        )
        steel = SectorEntry(
            sector="iron_steel",
            cn_codes=[_CN_STEEL],
            goods_line_count=3,
            total_net_mass_t=_D("50.000"),
            total_direct_kgco2e=_D("30000.000"),
            total_indirect_kgco2e=_D("3000.000"),
            total_embedded_tco2e=_D("33.000"),
            avg_see_tco2e_per_t=_D("0.660000"),
            projected_cbam_cost_eur=_D("1650.00"),
            share_of_total_pct=_D("27.5"),
        )
        return SectorSummaryResult(
            reporting_year=2024,
            reporting_quarter=1,
            eu_ets_price_eur=_D("50"),
            total_embedded_tco2e=_D("120.000"),
            total_projected_cost_eur=_D("6000.00"),
            sectors=[cement, steel],
        )

    def test_sector_summary_returns_200(self, monkeypatch):
        monkeypatch.setattr(
            "ledger_app.api.cbam.insights.get_sector_summary",
            lambda conn, **kw: self._mock_sector(),
        )
        resp = self.client.get(f"/api/cbam/insights/sector-summary?importer_eori={_EORI}")
        assert resp.status_code == 200

    def test_sector_summary_has_totals(self, monkeypatch):
        monkeypatch.setattr(
            "ledger_app.api.cbam.insights.get_sector_summary",
            lambda conn, **kw: self._mock_sector(),
        )
        body = self.client.get(f"/api/cbam/insights/sector-summary?importer_eori={_EORI}").json()
        assert "total_embedded_tco2e" in body
        assert "total_projected_cost_eur" in body
        assert "sectors" in body

    def test_sector_share_fields_present(self, monkeypatch):
        monkeypatch.setattr(
            "ledger_app.api.cbam.insights.get_sector_summary",
            lambda conn, **kw: self._mock_sector(),
        )
        body = self.client.get(f"/api/cbam/insights/sector-summary?importer_eori={_EORI}").json()
        for sec in body["sectors"]:
            assert "share_of_total_pct" in sec
            assert "avg_see_tco2e_per_t" in sec
            assert "cn_codes" in sec


# ── Service layer unit tests ──────────────────────────────────────────────────

class _MockMappings:
    def __init__(self, rows):
        self._rows = rows
    def all(self):
        return self._rows
    def one_or_none(self):
        return self._rows[0] if self._rows else None


class _MockResult:
    def __init__(self, rows):
        self._rows = rows
    def mappings(self):
        return _MockMappings(self._rows)


def _make_conn(rows_by_call: list[list[dict]]):
    """Return a mock connection whose execute() returns rows in sequence."""
    call_iter = iter(rows_by_call)

    mock_conn = MagicMock()

    # _table_columns queries — return standard column lists
    standard_cols = [
        {"column_name": "id", "is_nullable": "NO", "column_default": None},
        {"column_name": "importer_eori", "is_nullable": "NO", "column_default": None},
        {"column_name": "reporting_year", "is_nullable": "NO", "column_default": None},
        {"column_name": "reporting_quarter", "is_nullable": "NO", "column_default": None},
        {"column_name": "cbam_case_id", "is_nullable": "NO", "column_default": None},
        {"column_name": "net_mass_kg", "is_nullable": "NO", "column_default": None},
        {"column_name": "direct_embedded_kgco2e", "is_nullable": "NO", "column_default": None},
        {"column_name": "indirect_embedded_kgco2e", "is_nullable": "YES", "column_default": None},
        {"column_name": "calculation_method", "is_nullable": "NO", "column_default": None},
        {"column_name": "origin_country", "is_nullable": "YES", "column_default": None},
        {"column_name": "cn_code", "is_nullable": "NO", "column_default": None},
    ]

    def _execute(stmt, params=None):
        sql = str(stmt)
        if "information_schema.columns" in sql:
            return _MockResult(standard_cols)
        try:
            rows = next(call_iter)
        except StopIteration:
            rows = []
        return _MockResult(rows)

    mock_conn.execute.side_effect = _execute
    return mock_conn


class TestGetImporterKPIsService:
    def test_kpis_returns_importerkpis_instance(self):
        # Two calls: main aggregation + case/shipment count
        rows1 = [
            {"goods_line_count": 4, "total_mass_t": 10.0, "total_direct_kg": 8100.0,
             "total_indirect_kg": 600.0, "total_embedded_tco2e": 8.7,
             "method": "default", "origin_country": "CN", "cn_code": _CN_CEMENT},
        ]
        rows2 = [{"c_count": 1, "s_count": 2}]
        conn = _make_conn([rows1, rows2])
        result = get_importer_kpis(
            conn, tenant_id="", importer_eori=_EORI, year=2024, quarter=1
        )
        assert isinstance(result, ImporterKPIs)

    def test_kpis_total_embedded_sums_rows(self):
        rows1 = [
            {"goods_line_count": 2, "total_mass_t": 5.0, "total_direct_kg": 4050.0,
             "total_indirect_kg": 300.0, "total_embedded_tco2e": 4.35,
             "method": "default", "origin_country": "CN", "cn_code": _CN_CEMENT},
            {"goods_line_count": 2, "total_mass_t": 5.0, "total_direct_kg": 4050.0,
             "total_indirect_kg": 300.0, "total_embedded_tco2e": 4.35,
             "method": "actual", "origin_country": "TR", "cn_code": _CN_CEMENT},
        ]
        rows2 = [{"c_count": 1, "s_count": 2}]
        conn = _make_conn([rows1, rows2])
        result = get_importer_kpis(
            conn, tenant_id="", importer_eori=_EORI
        )
        assert float(result.total_embedded_tco2e) == pytest.approx(8.7, rel=1e-3)

    def test_kpis_method_breakdown(self):
        rows1 = [
            {"goods_line_count": 3, "total_mass_t": 5.0, "total_direct_kg": 0.0,
             "total_indirect_kg": 0.0, "total_embedded_tco2e": 0.0,
             "method": "default", "origin_country": "CN", "cn_code": _CN_CEMENT},
            {"goods_line_count": 1, "total_mass_t": 2.0, "total_direct_kg": 0.0,
             "total_indirect_kg": 0.0, "total_embedded_tco2e": 0.0,
             "method": "actual", "origin_country": "CN", "cn_code": _CN_STEEL},
        ]
        rows2 = [{"c_count": 1, "s_count": 1}]
        conn = _make_conn([rows1, rows2])
        result = get_importer_kpis(conn, tenant_id="", importer_eori=_EORI)
        assert result.method_breakdown.get("default") == 3
        assert result.method_breakdown.get("actual") == 1

    def test_kpis_empty_data(self):
        conn = _make_conn([[], [{"c_count": 0, "s_count": 0}]])
        result = get_importer_kpis(conn, tenant_id="", importer_eori=_EORI)
        assert result.total_cases == 0
        assert result.total_embedded_tco2e == _D("0")
        assert result.cbam_certificates_required == 0

    def test_kpis_certificate_count_rounds_up(self):
        rows1 = [
            {"goods_line_count": 1, "total_mass_t": 10.0, "total_direct_kg": 8100.0,
             "total_indirect_kg": 600.0, "total_embedded_tco2e": 8.7,
             "method": "default", "origin_country": "CN", "cn_code": _CN_CEMENT},
        ]
        rows2 = [{"c_count": 1, "s_count": 1}]
        conn = _make_conn([rows1, rows2])
        result = get_importer_kpis(conn, tenant_id="", importer_eori=_EORI)
        import math
        assert result.cbam_certificates_required == math.ceil(float(result.total_embedded_tco2e))

    def test_kpis_projected_cost_equals_certs_times_price(self):
        rows1 = [
            {"goods_line_count": 1, "total_mass_t": 10.0, "total_direct_kg": 8100.0,
             "total_indirect_kg": 600.0, "total_embedded_tco2e": 8.7,
             "method": "default", "origin_country": "CN", "cn_code": _CN_CEMENT},
        ]
        rows2 = [{"c_count": 1, "s_count": 1}]
        conn = _make_conn([rows1, rows2])
        price = _D("75")
        result = get_importer_kpis(conn, tenant_id="", importer_eori=_EORI, eu_ets_price_eur=price)
        expected = _D(str(result.cbam_certificates_required)) * price
        assert result.projected_cbam_cost_eur == expected

    def test_kpis_top_cn_codes_limited_to_5(self):
        rows1 = [
            {"goods_line_count": 1, "total_mass_t": 1.0, "total_direct_kg": float(i) * 100,
             "total_indirect_kg": 0.0, "total_embedded_tco2e": float(i) * 0.1,
             "method": "default", "origin_country": "CN", "cn_code": f"2523290{i}"}
            for i in range(1, 9)  # 8 distinct CN codes
        ]
        rows2 = [{"c_count": 1, "s_count": 1}]
        conn = _make_conn([rows1, rows2])
        result = get_importer_kpis(conn, tenant_id="", importer_eori=_EORI)
        assert len(result.top_cn_codes) <= 5


class TestGetSupplierComparisonService:
    def _supplier_rows(self):
        return [
            # Sorted ASC by embedded_tco2e (done in SQL ORDER BY)
            {"supplier_id": "CN", "gl_count": 3, "mass_t": 60.0,
             "direct_kg": 45000.0, "indirect_kg": 3600.0, "embedded_tco2e": 48.6},
            {"supplier_id": "TR", "gl_count": 2, "mass_t": 40.0,
             "direct_kg": 40000.0, "indirect_kg": 2400.0, "embedded_tco2e": 42.4},
        ]

    def test_supplier_comparison_returns_result(self):
        conn = _make_conn([self._supplier_rows()])
        result = get_supplier_comparison(
            conn, tenant_id="", importer_eori=_EORI, cn_code=_CN_CEMENT
        )
        assert isinstance(result, SupplierComparisonResult)

    def test_supplier_comparison_lowest_is_rank1(self):
        conn = _make_conn([self._supplier_rows()])
        result = get_supplier_comparison(
            conn, tenant_id="", importer_eori=_EORI, cn_code=_CN_CEMENT
        )
        # Rows come back sorted ASC by embedded_tco2e — rank 1 = lowest
        assert result.suppliers[0].carbon_intensity_rank == 1
        assert result.lowest_carbon_supplier == result.suppliers[0].supplier_identifier

    def test_supplier_comparison_highest_is_last(self):
        conn = _make_conn([self._supplier_rows()])
        result = get_supplier_comparison(
            conn, tenant_id="", importer_eori=_EORI, cn_code=_CN_CEMENT
        )
        assert result.highest_carbon_supplier == result.suppliers[-1].supplier_identifier

    def test_supplier_see_computed_correctly(self):
        conn = _make_conn([[
            {"supplier_id": "CN", "gl_count": 1, "mass_t": 10.0,
             "direct_kg": 8100.0, "indirect_kg": 600.0, "embedded_tco2e": 8.7},
        ]])
        result = get_supplier_comparison(
            conn, tenant_id="", importer_eori=_EORI, cn_code=_CN_CEMENT
        )
        entry = result.suppliers[0]
        # SEE direct = 8100 kgCO2e / 10000 kg = 0.81 tCO2e/t
        assert float(entry.see_direct_tco2e_per_t) == pytest.approx(0.81, rel=1e-3)

    def test_supplier_potential_saving_is_difference(self):
        conn = _make_conn([self._supplier_rows()])
        result = get_supplier_comparison(
            conn, tenant_id="", importer_eori=_EORI, cn_code=_CN_CEMENT,
            eu_ets_price_eur=_D("50"),
        )
        expected = result.suppliers[-1].projected_cbam_cost_eur - result.suppliers[0].projected_cbam_cost_eur
        assert result.potential_saving_eur == expected

    def test_supplier_empty_returns_valid_result(self):
        conn = _make_conn([[]])
        result = get_supplier_comparison(
            conn, tenant_id="", importer_eori=_EORI, cn_code=_CN_CEMENT
        )
        assert result.suppliers == []
        assert result.lowest_carbon_supplier is None


class TestGetCountryIntensityService:
    def test_country_intensity_returns_result(self):
        conn = _make_conn([[
            {"country": "CN", "gl_count": 4, "mass_t": 80.0, "embedded_tco2e": 75.0},
            {"country": "TR", "gl_count": 2, "mass_t": 30.0, "embedded_tco2e": 20.0},
        ]])
        result = get_country_intensity(conn, tenant_id="", importer_eori=_EORI)
        assert isinstance(result, CountryIntensityResult)
        assert len(result.countries) == 2

    def test_country_ranked_desc_by_embedded(self):
        conn = _make_conn([[
            # SQL returns them in DESC order already
            {"country": "CN", "gl_count": 4, "mass_t": 80.0, "embedded_tco2e": 75.0},
            {"country": "TR", "gl_count": 2, "mass_t": 30.0, "embedded_tco2e": 20.0},
        ]])
        result = get_country_intensity(conn, tenant_id="", importer_eori=_EORI)
        assert result.countries[0].origin_country == "CN"
        assert result.countries[0].carbon_intensity_rank == 1

    def test_country_avg_see_computed(self):
        conn = _make_conn([[
            {"country": "CN", "gl_count": 1, "mass_t": 10.0, "embedded_tco2e": 8.7},
        ]])
        result = get_country_intensity(conn, tenant_id="", importer_eori=_EORI)
        # avg_see = embedded_tco2e(t) * 1000 / mass_kg = 8.7 * 1000 / 10000 = 0.87
        assert float(result.countries[0].avg_see_tco2e_per_t) == pytest.approx(0.87, rel=1e-3)


class TestGetSectorSummaryService:
    def test_sector_summary_returns_result(self):
        rows = [
            {"goods_line_count": 5, "total_mass_t": 100.0, "total_direct_kg": 81000.0,
             "total_indirect_kg": 6000.0, "total_embedded_tco2e": 87.0,
             "method": "default", "origin_country": "CN", "cn_code": _CN_CEMENT},
            {"goods_line_count": 3, "total_mass_t": 50.0, "total_direct_kg": 30000.0,
             "total_indirect_kg": 3000.0, "total_embedded_tco2e": 33.0,
             "method": "actual", "origin_country": "CN", "cn_code": _CN_STEEL},
        ]
        conn = _make_conn([rows])
        result = get_sector_summary(conn, tenant_id="", importer_eori=_EORI)
        assert isinstance(result, SectorSummaryResult)

    def test_sector_share_sums_to_100(self):
        rows = [
            {"goods_line_count": 5, "total_mass_t": 100.0, "total_direct_kg": 81000.0,
             "total_indirect_kg": 6000.0, "total_embedded_tco2e": 87.0,
             "method": "default", "origin_country": "CN", "cn_code": _CN_CEMENT},
            {"goods_line_count": 3, "total_mass_t": 50.0, "total_direct_kg": 30000.0,
             "total_indirect_kg": 3000.0, "total_embedded_tco2e": 33.0,
             "method": "actual", "origin_country": "CN", "cn_code": _CN_STEEL},
        ]
        conn = _make_conn([rows])
        result = get_sector_summary(conn, tenant_id="", importer_eori=_EORI)
        total_share = sum(float(s.share_of_total_pct) for s in result.sectors)
        assert total_share == pytest.approx(100.0, abs=0.5)

    def test_sector_grand_total(self):
        rows = [
            {"goods_line_count": 5, "total_mass_t": 100.0, "total_direct_kg": 81000.0,
             "total_indirect_kg": 6000.0, "total_embedded_tco2e": 87.0,
             "method": "default", "origin_country": "CN", "cn_code": _CN_CEMENT},
        ]
        conn = _make_conn([rows])
        result = get_sector_summary(conn, tenant_id="", importer_eori=_EORI)
        assert float(result.total_embedded_tco2e) == pytest.approx(87.0, rel=1e-3)

    def test_sector_sorted_desc_by_emissions(self):
        rows = [
            {"goods_line_count": 3, "total_mass_t": 50.0, "total_direct_kg": 30000.0,
             "total_indirect_kg": 3000.0, "total_embedded_tco2e": 33.0,
             "method": "actual", "origin_country": "CN", "cn_code": _CN_STEEL},
            {"goods_line_count": 5, "total_mass_t": 100.0, "total_direct_kg": 81000.0,
             "total_indirect_kg": 6000.0, "total_embedded_tco2e": 87.0,
             "method": "default", "origin_country": "CN", "cn_code": _CN_CEMENT},
        ]
        conn = _make_conn([rows])
        result = get_sector_summary(conn, tenant_id="", importer_eori=_EORI)
        # Cement has higher embedded → should be first
        assert float(result.sectors[0].total_embedded_tco2e) >= float(result.sectors[1].total_embedded_tco2e)

    def test_sector_cn_codes_list(self):
        rows = [
            {"goods_line_count": 2, "total_mass_t": 40.0, "total_direct_kg": 32400.0,
             "total_indirect_kg": 2400.0, "total_embedded_tco2e": 34.8,
             "method": "default", "origin_country": "CN", "cn_code": "25232900"},
            {"goods_line_count": 3, "total_mass_t": 60.0, "total_direct_kg": 48600.0,
             "total_indirect_kg": 3600.0, "total_embedded_tco2e": 52.2,
             "method": "default", "origin_country": "TR", "cn_code": "25231000"},
        ]
        conn = _make_conn([rows])
        result = get_sector_summary(conn, tenant_id="", importer_eori=_EORI)
        cement = next(s for s in result.sectors if s.sector == "cement")
        assert "25232900" in cement.cn_codes
        assert "25231000" in cement.cn_codes
