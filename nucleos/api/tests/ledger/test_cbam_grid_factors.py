"""Tests for cbam_grid_factors.py — country electricity emission factors (D1)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from ledger_app.services.cbam_grid_factors import (
    compute_indirect_from_electricity,
    get_all_grid_factors,
    get_grid_factor,
    list_cbam_relevant_countries,
)

_D = Decimal


# ── get_grid_factor ────────────────────────────────────────────────────────────

class TestGetGridFactor:
    def test_china_returns_known_value(self):
        assert get_grid_factor("CN") == _D("0.5810")

    def test_india_returns_known_value(self):
        assert get_grid_factor("IN") == _D("0.7090")

    def test_russia_returns_known_value(self):
        assert get_grid_factor("RU") == _D("0.3220")

    def test_south_africa_returns_known_value(self):
        assert get_grid_factor("ZA") == _D("0.8280")

    def test_turkey_returns_known_value(self):
        assert get_grid_factor("TR") == _D("0.4530")

    def test_ukraine_returns_known_value(self):
        assert get_grid_factor("UA") == _D("0.3490")

    def test_uk_returns_known_value(self):
        assert get_grid_factor("GB") == _D("0.2070")

    def test_world_avg_returns_known_value(self):
        assert get_grid_factor("WORLD_AVG") == _D("0.4940")

    def test_unknown_country_returns_world_avg(self):
        assert get_grid_factor("XX") == _D("0.4940")

    def test_none_returns_world_avg(self):
        assert get_grid_factor(None) == _D("0.4940")

    def test_empty_string_returns_world_avg(self):
        assert get_grid_factor("") == _D("0.4940")

    def test_case_insensitive(self):
        assert get_grid_factor("cn") == get_grid_factor("CN")
        assert get_grid_factor("in") == get_grid_factor("IN")

    def test_all_values_positive(self):
        factors = get_all_grid_factors()
        for country, factor in factors.items():
            assert factor > _D("0"), f"Non-positive factor for {country}: {factor}"

    def test_all_values_are_decimal(self):
        factors = get_all_grid_factors()
        for country, factor in factors.items():
            assert isinstance(factor, Decimal), f"Non-Decimal factor for {country}"

    def test_high_coal_countries_above_05(self):
        for country in ("CN", "IN", "ZA", "MA", "KZ", "PL"):
            assert get_grid_factor(country) >= _D("0.5"), (
                f"{country} should be >= 0.5 tCO2e/MWh (coal-heavy)"
            )

    def test_hydro_countries_below_02(self):
        for country in ("AL", "BR", "KE", "SE"):
            assert get_grid_factor(country) <= _D("0.2"), (
                f"{country} should be <= 0.2 tCO2e/MWh (hydro/nuclear dominant)"
            )

    def test_brazil_hydro_dominant(self):
        assert get_grid_factor("BR") < _D("0.1")

    def test_france_nuclear_dominant(self):
        assert get_grid_factor("FR") < _D("0.1")


# ── compute_indirect_from_electricity ─────────────────────────────────────────

class TestComputeIndirectFromElectricity:
    def test_basic_calculation(self):
        # 2000 kWh/t × CN factor (0.5810 tCO2e/MWh) / 1000 kWh/MWh
        # = 2000/1000 × 0.5810 = 2 × 0.5810 = 1.162 tCO2e/t
        result = compute_indirect_from_electricity(_D("2000"), "CN")
        assert float(result) == pytest.approx(1.162, rel=1e-4)

    def test_world_avg_used_for_unknown_country(self):
        result_unknown = compute_indirect_from_electricity(_D("1000"), "XX")
        result_world = compute_indirect_from_electricity(_D("1000"), "WORLD_AVG")
        assert result_unknown == result_world

    def test_zero_kwh_returns_zero(self):
        result = compute_indirect_from_electricity(_D("0"), "CN")
        assert result == _D("0")

    def test_negative_kwh_returns_zero(self):
        result = compute_indirect_from_electricity(_D("-100"), "CN")
        assert result == _D("0")

    def test_none_country_uses_world_avg(self):
        result_none = compute_indirect_from_electricity(_D("1000"), None)
        result_world = compute_indirect_from_electricity(_D("1000"), "WORLD_AVG")
        assert result_none == result_world

    def test_returns_decimal(self):
        result = compute_indirect_from_electricity(1500, "TR")
        assert isinstance(result, Decimal)

    def test_float_input_accepted(self):
        result = compute_indirect_from_electricity(2500.0, "IN")
        assert result > _D("0")

    def test_unit_conversion_kwh_to_mwh(self):
        # 1000 kWh = 1 MWh; factor for WORLD_AVG = 0.4940
        result = compute_indirect_from_electricity(_D("1000"), "WORLD_AVG")
        expected = _D("0.4940")
        assert result == expected

    def test_aluminium_typical_electricity(self):
        # Primary aluminium: ~13,500 kWh/t (industry average)
        # CN grid: 13500/1000 × 0.5810 = 7.8435 tCO2e/t indirect
        result = compute_indirect_from_electricity(_D("13500"), "CN")
        expected = float(_D("13.5") * _D("0.5810"))
        assert float(result) == pytest.approx(expected, rel=1e-4)

    def test_ammonia_typical_electricity(self):
        # Haber-Bosch ammonia: ~120 kWh/t (electricity component only)
        # India grid: 120/1000 × 0.7090 = 0.08508 tCO2e/t indirect
        result = compute_indirect_from_electricity(_D("120"), "IN")
        expected = float(_D("0.120") * _D("0.7090"))
        assert float(result) == pytest.approx(expected, rel=1e-4)


# ── get_all_grid_factors ───────────────────────────────────────────────────────

class TestGetAllGridFactors:
    def test_returns_dict(self):
        factors = get_all_grid_factors()
        assert isinstance(factors, dict)

    def test_contains_major_countries(self):
        factors = get_all_grid_factors()
        for country in ("CN", "IN", "RU", "TR", "ZA", "WORLD_AVG"):
            assert country in factors, f"{country} missing from grid factors"

    def test_is_a_copy(self):
        f1 = get_all_grid_factors()
        f2 = get_all_grid_factors()
        f1["FAKE"] = _D("99")
        assert "FAKE" not in f2


# ── list_cbam_relevant_countries ──────────────────────────────────────────────

class TestListCbamRelevantCountries:
    def test_returns_list(self):
        countries = list_cbam_relevant_countries()
        assert isinstance(countries, list)

    def test_contains_major_cbam_origins(self):
        countries = list_cbam_relevant_countries()
        for c in ("CN", "IN", "RU", "TR", "ZA"):
            assert c in countries, f"{c} missing from CBAM-relevant countries"

    def test_excludes_eu_eea(self):
        countries = list_cbam_relevant_countries()
        eu_eea = {"AT", "BE", "DE", "FR", "IT", "ES", "PL", "SE", "IS", "NO", "CH"}
        for c in eu_eea:
            assert c not in countries, f"EU/EEA country {c} should not appear"

    def test_excludes_world_avg_key(self):
        countries = list_cbam_relevant_countries()
        assert "WORLD_AVG" not in countries

    def test_sorted_alphabetically(self):
        countries = list_cbam_relevant_countries()
        assert countries == sorted(countries)
