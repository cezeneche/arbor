"""Tests for cbam_reconciler.py — quarterly aggregation, supplier SEE consistency,
and Art. 9 carbon price plausibility checks (B1, B2, B3).
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from ledger_app.services.cbam_reconciler import (
    CARBON_PRICE_HIGH_BAND,
    CARBON_PRICE_LOW_BAND,
    MIN_HISTORY_FOR_STATS,
    SUPPLIER_SEE_DEVIATION_THRESHOLD,
    CarbonPriceFlag,
    QuarterlyReconciliationResult,
    SupplierSEEFlag,
    check_carbon_price_plausibility,
    check_supplier_see_consistency,
    get_eua_reference_price,
    reconcile_quarter,
)

_D = Decimal


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_case(
    case_id: str = "case-1",
    eori: str = "DE12345678900001",
    year: int = 2024,
    quarter: int = 2,
    origin: str = "CN",
    cp_paid: str = "0",
    goods_lines: list | None = None,
) -> dict:
    return {
        "id": case_id,
        "importer_eori": eori,
        "reporting_year": year,
        "reporting_quarter": quarter,
        "origin_country": origin,
        "carbon_price_paid_eur": _D(cp_paid),
        "goods_lines": goods_lines or [
            {
                "goods_line_id": "gl-1",
                "cn_code": "72081000",
                "supplier_eori": "CN-SUPP-001",
                "net_mass_kg": _D("10000"),
                "direct_kgco2e": _D("19000"),
                "indirect_kgco2e": _D("1000"),
            }
        ],
    }


# ── B1: Quarterly aggregation ─────────────────────────────────────────────────

class TestReconcileQuarterAggregation:
    def test_single_case_aggregates_correctly(self):
        cases = [_make_case()]
        result = reconcile_quarter(
            cases=cases,
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
            eu_ets_price_eur=_D("65"),
        )
        assert result.case_count == 1
        assert result.goods_line_count == 1
        assert result.total_net_mass_t == _D("10")  # 10000 kg / 1000
        # direct_tco2e = 19000/1000 = 19, indirect = 1000/1000 = 1
        assert result.total_direct_tco2e == _D("19")
        assert result.total_indirect_tco2e == _D("1")
        assert result.total_embedded_tco2e == _D("20")  # 20 tCO2e
        assert result.cbam_certificates_required == 20  # ceil(20)

    def test_two_cases_sum_embeddings(self):
        case1 = _make_case("c1", goods_lines=[{
            "goods_line_id": "g1", "cn_code": "72081000", "supplier_eori": "",
            "net_mass_kg": _D("5000"), "direct_kgco2e": _D("10000"), "indirect_kgco2e": _D("0"),
        }])
        case2 = _make_case("c2", goods_lines=[{
            "goods_line_id": "g2", "cn_code": "72081000", "supplier_eori": "",
            "net_mass_kg": _D("5000"), "direct_kgco2e": _D("10000"), "indirect_kgco2e": _D("0"),
        }])
        result = reconcile_quarter(
            cases=[case1, case2],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
        )
        assert result.case_count == 2
        assert result.total_embedded_tco2e == _D("20")

    def test_cases_from_different_quarter_are_excluded(self):
        wrong_quarter = _make_case("c-wrong", quarter=3)
        right_quarter = _make_case("c-right", quarter=2)
        result = reconcile_quarter(
            cases=[wrong_quarter, right_quarter],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
        )
        assert result.case_count == 1
        assert "c-right" in result.case_ids
        assert "c-wrong" not in result.case_ids

    def test_cases_from_different_eori_are_excluded(self):
        wrong_eori = _make_case("c-other", eori="GB99999999999999")
        right_eori = _make_case("c-mine")
        result = reconcile_quarter(
            cases=[wrong_eori, right_eori],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
        )
        assert result.case_count == 1

    def test_empty_cases_returns_zero_result(self):
        result = reconcile_quarter(
            cases=[],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
        )
        assert result.case_count == 0
        assert result.total_embedded_tco2e == _D("0")
        assert result.cbam_certificates_required == 0

    def test_certificates_rounded_up(self):
        # 1.1 tCO2e → ceil = 2 certificates
        case = _make_case(goods_lines=[{
            "goods_line_id": "g1", "cn_code": "72081000", "supplier_eori": "",
            "net_mass_kg": _D("1000"), "direct_kgco2e": _D("1100"), "indirect_kgco2e": _D("0"),
        }])
        result = reconcile_quarter(
            cases=[case],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
        )
        assert result.cbam_certificates_required == 2  # ceil(1.1)

    def test_returns_quarterly_reconciliation_result_type(self):
        result = reconcile_quarter(
            cases=[_make_case()],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
        )
        assert isinstance(result, QuarterlyReconciliationResult)

    def test_case_ids_listed_in_result(self):
        cases = [_make_case("id-alpha"), _make_case("id-beta")]
        result = reconcile_quarter(
            cases=cases,
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
        )
        assert set(result.case_ids) == {"id-alpha", "id-beta"}


# ── Art. 9 deduction ───────────────────────────────────────────────────────────

class TestArt9Deduction:
    def test_zero_carbon_price_no_deduction(self):
        result = reconcile_quarter(
            cases=[_make_case(cp_paid="0")],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
            eu_ets_price_eur=_D("65"),
        )
        assert result.total_carbon_price_deduction_tco2e == _D("0")
        assert result.net_liability_tco2e == result.total_embedded_tco2e

    def test_full_carbon_price_equals_ets_zero_liability(self):
        # declared == EUA price → 100% deduction → net_liability = 0
        result = reconcile_quarter(
            cases=[_make_case(cp_paid="65")],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
            eu_ets_price_eur=_D("65"),
        )
        assert result.net_liability_tco2e == _D("0")
        assert result.cbam_certificates_required == 0

    def test_partial_deduction_reduces_liability(self):
        # cp_paid = 32.5 = 50% of EUA 65 → net = 50% of embedded
        result = reconcile_quarter(
            cases=[_make_case(cp_paid="32.5")],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
            eu_ets_price_eur=_D("65"),
        )
        assert result.net_liability_tco2e < result.total_embedded_tco2e
        assert result.net_liability_tco2e > _D("0")

    def test_net_liability_never_negative(self):
        # cp_paid > EUA → deduction capped so net_liability >= 0
        result = reconcile_quarter(
            cases=[_make_case(cp_paid="200")],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
            eu_ets_price_eur=_D("65"),
        )
        assert result.net_liability_tco2e >= _D("0")


# ── Financial liability ────────────────────────────────────────────────────────

class TestFinancialLiability:
    def test_financial_liability_computed_when_ets_price_given(self):
        result = reconcile_quarter(
            cases=[_make_case()],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
            eu_ets_price_eur=_D("65"),
        )
        assert result.gross_financial_liability_eur is not None
        assert result.net_financial_liability_eur is not None
        assert result.gross_financial_liability_eur == result.total_embedded_tco2e * _D("65")

    def test_financial_liability_none_when_no_ets_price(self):
        result = reconcile_quarter(
            cases=[_make_case()],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
            eu_ets_price_eur=None,
        )
        assert result.gross_financial_liability_eur is None
        assert result.net_financial_liability_eur is None


# ── B2: Supplier SEE consistency ──────────────────────────────────────────────

class TestSupplierSEEConsistency:
    def _history(self, values: list[float]) -> list[Decimal]:
        return [_D(str(v)) for v in values]

    def test_no_flag_when_history_too_short(self):
        # Less than MIN_HISTORY_FOR_STATS entries → no check
        hist = self._history([1.9, 2.0])  # only 2 entries
        flag = check_supplier_see_consistency(
            current_see=_D("5.0"),  # wildly different but history too short
            cn_code="72081000",
            supplier_eori="CN-SUPP-001",
            history=hist,
        )
        assert flag is None

    def test_no_flag_within_threshold(self):
        hist = self._history([2.0, 2.1, 1.95, 2.05, 2.0])
        flag = check_supplier_see_consistency(
            current_see=_D("2.1"),  # 5% deviation — within 30% threshold
            cn_code="72081000",
            supplier_eori="CN-SUPP-001",
            history=hist,
        )
        assert flag is None

    def test_flag_raised_above_threshold(self):
        hist = self._history([2.0, 2.0, 2.0, 2.0, 2.0])
        flag = check_supplier_see_consistency(
            current_see=_D("3.0"),  # 50% deviation > 30% threshold
            cn_code="72081000",
            supplier_eori="CN-SUPP-001",
            history=hist,
        )
        assert flag is not None
        assert isinstance(flag, SupplierSEEFlag)
        assert flag.deviation_pct > SUPPLIER_SEE_DEVIATION_THRESHOLD
        assert flag.cn_code == "72081000"
        assert flag.supplier_eori == "CN-SUPP-001"

    def test_flag_raised_for_low_anomaly(self):
        hist = self._history([2.0, 2.0, 2.0, 2.0, 2.0])
        flag = check_supplier_see_consistency(
            current_see=_D("0.5"),  # 75% below mean → anomalously low
            cn_code="72081000",
            supplier_eori="CN-SUPP-001",
            history=hist,
        )
        assert flag is not None
        assert flag.direction if hasattr(flag, "direction") else True  # anomaly exists

    def test_flag_contains_rolling_mean(self):
        hist = self._history([2.0, 2.0, 2.0, 2.0, 2.0])
        flag = check_supplier_see_consistency(
            current_see=_D("4.0"),
            cn_code="72081000",
            supplier_eori="CN-SUPP-001",
            history=hist,
        )
        assert flag is not None
        assert flag.rolling_mean == _D("2.000000")

    def test_supplier_flags_appear_in_reconcile_result(self):
        history = {
            ("CN-SUPP-001", "72081000"): (
                [_D("2.0")] * 5,
                ["old-case-1", "old-case-2", "old-case-3", "old-case-4", "old-case-5"],
            )
        }
        # The test case has SEE = (19000+1000)/10000 = 2.0 tCO2e/t — within threshold
        result = reconcile_quarter(
            cases=[_make_case()],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
            supplier_see_history=history,
        )
        assert result.supplier_see_flags == []  # no anomaly

    def test_supplier_flag_detected_in_reconcile(self):
        # History has mean=2.0, but current case has SEE ~20.0 (wildly different)
        history = {
            ("CN-SUPP-001", "72081000"): (
                [_D("2.0")] * 5,
                ["c1", "c2", "c3", "c4", "c5"],
            )
        }
        high_emission_case = _make_case(goods_lines=[{
            "goods_line_id": "gl-hi",
            "cn_code": "72081000",
            "supplier_eori": "CN-SUPP-001",
            "net_mass_kg": _D("10000"),
            "direct_kgco2e": _D("200000"),   # SEE = 20 tCO2e/t vs mean 2.0
            "indirect_kgco2e": _D("0"),
        }])
        result = reconcile_quarter(
            cases=[high_emission_case],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
            supplier_see_history=history,
        )
        assert len(result.supplier_see_flags) == 1
        assert result.supplier_see_flags[0].supplier_eori == "CN-SUPP-001"

    def test_no_supplier_check_when_history_is_none(self):
        result = reconcile_quarter(
            cases=[_make_case()],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
            supplier_see_history=None,  # explicitly disabled
        )
        assert result.supplier_see_flags == []

    def test_case_ids_passed_to_flag(self):
        ids = ["case-A", "case-B", "case-C", "case-D", "case-E"]
        flag = check_supplier_see_consistency(
            current_see=_D("5.0"),
            cn_code="72081000",
            supplier_eori="SUPP",
            history=[_D("2.0")] * 5,
            history_case_ids=ids,
        )
        assert flag is not None
        assert flag.case_ids == ids


# ── B3: Carbon price plausibility ─────────────────────────────────────────────

class TestCarbonPricePlausibility:
    def test_plausible_price_no_flag(self):
        flag = check_carbon_price_plausibility(
            declared_price_eur=_D("65"),  # equal to reference → ratio = 1.0
            origin_country="CN",
            year=2024,
            quarter=2,
            reference_price_eur=_D("65"),
        )
        assert flag is None

    def test_too_low_price_flagged(self):
        flag = check_carbon_price_plausibility(
            declared_price_eur=_D("10"),  # 10/65 = 0.15 < 0.30 threshold
            origin_country="IN",
            year=2024,
            quarter=2,
            reference_price_eur=_D("65"),
        )
        assert flag is not None
        assert flag.direction == "too_low"
        assert flag.origin_country == "IN"

    def test_too_high_price_flagged(self):
        flag = check_carbon_price_plausibility(
            declared_price_eur=_D("200"),  # 200/65 = 3.07 > 2.0 threshold
            origin_country="RU",
            year=2024,
            quarter=2,
            reference_price_eur=_D("65"),
        )
        assert flag is not None
        assert flag.direction == "too_high"

    def test_zero_declared_price_no_flag(self):
        # Zero price means no Art. 9 claim — nothing to check
        flag = check_carbon_price_plausibility(
            declared_price_eur=_D("0"),
            origin_country="CN",
            year=2024,
            quarter=2,
            reference_price_eur=_D("65"),
        )
        assert flag is None

    def test_uses_eua_table_when_no_reference_given(self):
        # Should not raise — uses internal reference table
        flag = check_carbon_price_plausibility(
            declared_price_eur=_D("5"),  # definitely too low
            origin_country="CN",
            year=2024,
            quarter=2,
            reference_price_eur=None,
        )
        assert flag is not None
        assert flag.direction == "too_low"

    def test_flag_contains_ratio(self):
        flag = check_carbon_price_plausibility(
            declared_price_eur=_D("13"),  # 13/65 = 0.2 < 0.30
            origin_country="CN",
            year=2024,
            quarter=2,
            reference_price_eur=_D("65"),
        )
        assert flag is not None
        assert flag.ratio == _D("0.2000")

    def test_carbon_flags_appear_in_reconcile_result(self):
        low_price_case = _make_case(cp_paid="5", origin="CN")
        result = reconcile_quarter(
            cases=[low_price_case],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
            eu_ets_price_eur=_D("65"),
        )
        assert len(result.carbon_price_flags) == 1
        assert result.carbon_price_flags[0].direction == "too_low"

    def test_plausible_price_no_flag_in_reconcile(self):
        fair_price_case = _make_case(cp_paid="50", origin="GB")
        result = reconcile_quarter(
            cases=[fair_price_case],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
            eu_ets_price_eur=_D("65"),
        )
        assert result.carbon_price_flags == []


# ── EUA reference table ───────────────────────────────────────────────────────

class TestEUAReferenceTable:
    def test_known_period_returns_value(self):
        price = get_eua_reference_price(2024, 2)
        assert price > _D("0")

    def test_unknown_period_returns_default(self):
        price = get_eua_reference_price(2099, 4)
        assert price == _D("65")  # default fallback

    def test_all_known_periods_return_positive(self):
        periods = [
            (2023, 4), (2024, 1), (2024, 2), (2024, 3), (2024, 4),
            (2025, 1), (2025, 2), (2025, 3), (2025, 4),
            (2026, 1), (2026, 2),
        ]
        for year, quarter in periods:
            price = get_eua_reference_price(year, quarter)
            assert price > _D("0"), f"Zero price for {year} Q{quarter}"


# ── Regulation references ─────────────────────────────────────────────────────

class TestRegulationRefs:
    def test_result_contains_regulation_refs(self):
        result = reconcile_quarter(
            cases=[],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
        )
        assert len(result.regulation_refs) >= 4
        refs_str = " ".join(result.regulation_refs)
        assert "2023/956" in refs_str
        assert "2023/1773" in refs_str
        assert "Art" in refs_str or "Article" in refs_str
