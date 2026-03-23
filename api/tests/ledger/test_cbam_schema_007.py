"""Tests for migration 007 schema additions and the emission factors seeder.

Coverage
--------
1. cbam_factors_seeder.seed_emission_factors()
   - Returns correct summary dict structure
   - Skips gracefully when migration 007 tables are absent
   - Inserts Annex VI SEE factors
   - Inserts electricity factors

2. cbam_factors_seeder.get_factor_from_db()
   - Returns factor row when present
   - Returns None when not found

3. Migration 007 schema assertions (via FakeConnection column list)
   - cbam_users table has expected columns
   - cbam_emission_factors table has expected columns
   - cbam_electricity_factors table has expected columns
   - cbam_emissions now has factor_table_version and production_route

4. Seeder is idempotent (ON CONFLICT DO NOTHING behaviour)

5. Users table column shape
"""

from __future__ import annotations

import os
from decimal import Decimal
from unittest.mock import MagicMock, patch, call

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")

from ledger_app.services.cbam_factors_seeder import (
    seed_emission_factors,
    get_factor_from_db,
    TABLE_VERSION,
)
from ledger_app.services.cbam_emission_factors import (
    _ANNEX_VI,
    ELECTRICITY_FACTORS,
    TABLE_VERSION as FACTOR_TABLE_VERSION,
)
from ledger_app.testing import FakeConnection


# ── Helpers ───────────────────────────────────────────────────────────────────

class _FakeResult:
    def __init__(self, rowcount=1, rows=None):
        self.rowcount = rowcount
        self._rows = rows or []
    def mappings(self):
        return self
    def all(self):
        return self._rows
    def one_or_none(self):
        return self._rows[0] if self._rows else None
    def scalar_one_or_none(self):
        return 1 if self._rows else None


def _make_engine(tables_present: bool = True, rowcount: int = 1):
    """Return a mock engine whose connections return configurable results."""
    mock_conn = MagicMock()

    def _execute(stmt, params=None):
        sql = str(stmt)
        if "information_schema.tables" in sql:
            # Migration 007 tables present or absent
            return _FakeResult(rows=[{"table_name": "cbam_emission_factors"}] if tables_present else [])
        if "ON CONFLICT" in sql:
            return _FakeResult(rowcount=rowcount)
        return _FakeResult(rows=[])

    mock_conn.execute.side_effect = _execute
    mock_conn.__enter__ = lambda s: mock_conn
    mock_conn.__exit__ = MagicMock(return_value=False)

    mock_engine = MagicMock()
    mock_engine.begin.return_value = mock_conn
    return mock_engine


# ── Seeder tests ──────────────────────────────────────────────────────────────

class TestSeedEmissionFactors:
    def test_returns_dict(self):
        engine = _make_engine()
        result = seed_emission_factors(engine)
        assert isinstance(result, dict)

    def test_result_has_required_keys(self):
        engine = _make_engine()
        result = seed_emission_factors(engine)
        assert "annex_vi_inserted" in result
        assert "electricity_inserted" in result

    def test_skips_when_tables_absent(self):
        engine = _make_engine(tables_present=False)
        result = seed_emission_factors(engine)
        assert result.get("skipped") is True
        assert result["annex_vi_inserted"] == 0
        assert result["electricity_inserted"] == 0

    def test_annex_vi_count_matches_entries(self):
        engine = _make_engine(rowcount=1)
        result = seed_emission_factors(engine)
        # Every entry in _ANNEX_VI should be attempted
        assert result["annex_vi_inserted"] == len(_ANNEX_VI)

    def test_electricity_count_matches_countries(self):
        engine = _make_engine(rowcount=1)
        result = seed_emission_factors(engine)
        assert result["electricity_inserted"] == len(ELECTRICITY_FACTORS)

    def test_idempotent_zero_when_conflict(self):
        # ON CONFLICT DO NOTHING → rowcount=0
        engine = _make_engine(rowcount=0)
        result = seed_emission_factors(engine)
        assert result["annex_vi_inserted"] == 0
        assert result["electricity_inserted"] == 0

    def test_table_version_in_result(self):
        engine = _make_engine()
        result = seed_emission_factors(engine)
        assert result.get("table_version") == TABLE_VERSION

    def test_factor_metadata_in_result(self):
        engine = _make_engine()
        result = seed_emission_factors(engine)
        assert "factor_metadata" in result

    def test_handles_engine_error_gracefully(self):
        mock_engine = MagicMock()
        mock_engine.begin.side_effect = Exception("DB connection refused")
        result = seed_emission_factors(mock_engine)
        assert result["annex_vi_inserted"] == 0
        assert "error" in result

    def test_insert_called_for_each_annex_vi_entry(self):
        executed_sqls = []
        mock_conn = MagicMock()

        def _execute(stmt, params=None):
            sql = str(stmt)
            executed_sqls.append(sql)
            if "information_schema.tables" in sql:
                return _FakeResult(rows=[{"table_name": "cbam_emission_factors"}])
            return _FakeResult(rowcount=1)

        mock_conn.execute.side_effect = _execute
        mock_conn.__enter__ = lambda s: mock_conn
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_engine = MagicMock()
        mock_engine.begin.return_value = mock_conn

        seed_emission_factors(mock_engine)
        # One check + one INSERT per Annex VI entry + one per electricity country
        annex_inserts = [s for s in executed_sqls if "cbam_emission_factors" in s and "INSERT" in s]
        elec_inserts = [s for s in executed_sqls if "cbam_electricity_factors" in s and "INSERT" in s]
        assert len(annex_inserts) == len(_ANNEX_VI)
        assert len(elec_inserts) == len(ELECTRICITY_FACTORS)


class TestGetFactorFromDb:
    def _factor_row(self, cn="25232900", route=None):
        return {
            "cn8_prefix": cn,
            "production_route": route,
            "direct_tco2e_per_t": Decimal("0.810"),
            "indirect_tco2e_per_t": Decimal("0.060"),
            "description": "Grey Portland cement",
            "source_ref": "EU 2023/1773 Annex VI",
            "table_version": "2023",
        }

    def _conn_returning(self, row):
        mock_conn = MagicMock()
        result = MagicMock()
        result.mappings.return_value.one_or_none.return_value = row
        mock_conn.execute.return_value = result
        return mock_conn

    def test_returns_dict_when_found(self):
        conn = self._conn_returning(self._factor_row())
        result = get_factor_from_db(conn, "25232900")
        assert result is not None
        assert isinstance(result, dict)

    def test_returns_none_when_not_found(self):
        conn = self._conn_returning(None)
        result = get_factor_from_db(conn, "99999999")
        assert result is None

    def test_result_has_see_fields(self):
        conn = self._conn_returning(self._factor_row())
        result = get_factor_from_db(conn, "25232900")
        assert "direct_tco2e_per_t" in result
        assert "indirect_tco2e_per_t" in result

    def test_table_version_passed_to_query(self):
        executed = []
        mock_conn = MagicMock()
        def _exec(stmt, params=None):
            executed.append(params or {})
            result = MagicMock()
            result.mappings.return_value.one_or_none.return_value = self._factor_row()
            return result
        mock_conn.execute.side_effect = _exec
        get_factor_from_db(mock_conn, "25232900", table_version="2024")
        assert executed[0].get("table_version") == "2024"


# ── Schema shape tests (via FakeConnection column list) ──────────────────────

class TestMigration007Schema:
    """Verify migration 007 columns are present in the FakeConnection schema.

    These tests ensure the FakeConnection stays in sync with the actual
    migration file, so that route tests that introspect columns work correctly.
    """

    def setup_method(self):
        self.conn = FakeConnection()

    def _col_names(self, table: str) -> set[str]:
        return {col[0] for col in self.conn._columns[table]}

    def test_cbam_users_table_exists(self):
        assert "cbam_users" in self.conn._columns

    def test_cbam_users_has_sub(self):
        assert "sub" in self._col_names("cbam_users")

    def test_cbam_users_has_tenant_id(self):
        assert "tenant_id" in self._col_names("cbam_users")

    def test_cbam_users_has_role(self):
        assert "role" in self._col_names("cbam_users")

    def test_cbam_users_has_email(self):
        assert "email" in self._col_names("cbam_users")

    def test_cbam_users_has_is_active(self):
        assert "is_active" in self._col_names("cbam_users")

    def test_cbam_users_has_last_seen_at(self):
        assert "last_seen_at" in self._col_names("cbam_users")

    def test_cbam_emission_factors_table_exists(self):
        assert "cbam_emission_factors" in self.conn._columns

    def test_cbam_emission_factors_has_cn8_prefix(self):
        assert "cn8_prefix" in self._col_names("cbam_emission_factors")

    def test_cbam_emission_factors_has_sector(self):
        assert "sector" in self._col_names("cbam_emission_factors")

    def test_cbam_emission_factors_has_see_columns(self):
        cols = self._col_names("cbam_emission_factors")
        assert "direct_tco2e_per_t" in cols
        assert "indirect_tco2e_per_t" in cols

    def test_cbam_emission_factors_has_table_version(self):
        assert "table_version" in self._col_names("cbam_emission_factors")

    def test_cbam_emission_factors_has_effective_dates(self):
        cols = self._col_names("cbam_emission_factors")
        assert "effective_from" in cols
        assert "effective_to" in cols

    def test_cbam_electricity_factors_table_exists(self):
        assert "cbam_electricity_factors" in self.conn._columns

    def test_cbam_electricity_factors_has_country_iso2(self):
        assert "country_iso2" in self._col_names("cbam_electricity_factors")

    def test_cbam_electricity_factors_has_tco2e_per_mwh(self):
        assert "tco2e_per_mwh" in self._col_names("cbam_electricity_factors")

    def test_cbam_emissions_has_factor_table_version(self):
        assert "factor_table_version" in self._col_names("cbam_emissions")

    def test_cbam_emissions_has_production_route(self):
        assert "production_route" in self._col_names("cbam_emissions")


# ── Module constants ──────────────────────────────────────────────────────────

class TestFactorConstants:
    def test_table_version_is_string(self):
        assert isinstance(TABLE_VERSION, str)

    def test_table_version_matches_emission_factors_module(self):
        assert TABLE_VERSION == FACTOR_TABLE_VERSION

    def test_annex_vi_non_empty(self):
        assert len(_ANNEX_VI) > 50   # should have 100+ entries

    def test_electricity_factors_non_empty(self):
        assert len(ELECTRICITY_FACTORS) > 40   # 50+ countries

    def test_cement_cn_in_annex_vi(self):
        cn_codes = {e.cn8_prefix for e in _ANNEX_VI}
        assert "25232900" in cn_codes   # grey Portland cement

    def test_steel_cn_in_annex_vi(self):
        cn_codes = {e.cn8_prefix for e in _ANNEX_VI}
        # At least one iron/steel entry
        steel = [e for e in _ANNEX_VI if e.sector == "iron_steel"]
        assert len(steel) > 0

    def test_all_entries_have_positive_direct(self):
        for entry in _ANNEX_VI:
            assert entry.direct_tco2e_per_t >= 0, f"Negative direct SEE for {entry.cn8_prefix}"

    def test_all_entries_have_non_negative_indirect(self):
        for entry in _ANNEX_VI:
            assert entry.indirect_tco2e_per_t >= 0
