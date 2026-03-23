"""Tests for cbam_calculation_service — SEE formula and CBAM liability.

Coverage:
- compute_see: correct tCO2e/t values from kgCO2e and mass_kg
- compute_see: zero indirect emissions
- compute_see: raises ValueError for non-positive mass
- compute_cbam_liability: single goods line, no carbon price deduction
- compute_cbam_liability: multiple goods lines, totals aggregated correctly
- compute_cbam_liability: carbon price deduction applied correctly
- compute_cbam_liability: deduction capped at 100 % (net liability never negative)
- compute_cbam_liability: cbam_certificates rounded up (ceil)
- compute_cbam_liability: goods line with zero mass skipped cleanly
- compute_cbam_liability: raises ValueError for non-positive EU ETS price
- compute_cbam_liability: raises ValueError for negative carbon price paid
- CBAMLiabilityResult: regulation_refs are populated
- Financial liability: gross and net values correct
"""

from __future__ import annotations

import math
from decimal import Decimal

import pytest

from ledger_app.services.cbam_calculation_service import (
    CBAMLiabilityResult,
    compute_cbam_liability,
    compute_see,
)

_D = Decimal


# ── compute_see ───────────────────────────────────────────────────────────────

class TestComputeSEE:
    def test_direct_and_indirect(self):
        """SEE = kgCO2e / mass_t; 1000 kg steel with 2000 kgCO2e direct, 100 kgCO2e indirect."""
        see_d, see_i, see_t = compute_see(
            direct_kgco2e=_D("2000"),
            indirect_kgco2e=_D("100"),
            net_mass_kg=_D("1000"),
        )
        # mass_t = 1.0; SEE_d = 2000/1 = 2.000000; SEE_i = 100/1 = 0.100000
        assert see_d == _D("2.000000")
        assert see_i == _D("0.100000")
        assert see_t == _D("2.100000")

    def test_zero_indirect(self):
        """Zero indirect emissions → see_indirect = 0."""
        see_d, see_i, see_t = compute_see(
            direct_kgco2e=_D("633"),
            indirect_kgco2e=_D("0"),
            net_mass_kg=_D("1000"),
        )
        assert see_i == _D("0.000000")
        assert see_t == see_d

    def test_fractional_mass(self):
        """500 kgCO2e direct, 500 kg mass → see_d = 500/500 = 1.0 tCO2e/t."""
        see_d, _, _ = compute_see(
            direct_kgco2e=_D("500"),
            indirect_kgco2e=_D("0"),
            net_mass_kg=_D("500"),
        )
        assert see_d == _D("1.000000")

    def test_raises_on_zero_mass(self):
        with pytest.raises(ValueError, match="must be positive"):
            compute_see(_D("100"), _D("0"), _D("0"))

    def test_raises_on_negative_mass(self):
        with pytest.raises(ValueError, match="must be positive"):
            compute_see(_D("100"), _D("0"), _D("-10"))


# ── compute_cbam_liability ────────────────────────────────────────────────────

def _make_line(
    goods_line_id: str = "gl-1",
    cn_code: str = "25232900",
    net_mass_kg: float = 1000.0,
    direct_kgco2e: float = 633.0,
    indirect_kgco2e: float = 14.0,
) -> dict:
    return {
        "goods_line_id": goods_line_id,
        "cn_code": cn_code,
        "net_mass_kg": _D(str(net_mass_kg)),
        "direct_kgco2e": _D(str(direct_kgco2e)),
        "indirect_kgco2e": _D(str(indirect_kgco2e)),
    }


class TestComputeCBAMLiability:

    def test_single_line_no_deduction(self):
        """1 tonne grey cement, EU ETS = €50, no carbon price paid."""
        # direct=633 kgCO2e, indirect=14 kgCO2e, mass=1000 kg
        # SEE_d = 633/1000 = 0.633 tCO2e/t; SEE_i = 0.014; SEE_t = 0.647
        # embedded = 0.647 × 1 t = 0.647 tCO2e
        # no deduction; net_liability = 0.647; certificates = 1; financial = 0.647 × 50 = 32.35
        result = compute_cbam_liability(
            goods_lines=[_make_line()],
            eu_ets_price_eur=_D("50"),
            carbon_price_paid_eur=_D("0"),
        )
        assert isinstance(result, CBAMLiabilityResult)
        assert result.total_embedded_tco2e == _D("0.647000")
        assert result.carbon_price_deduction_tco2e == _D("0")
        assert result.net_liability_tco2e == _D("0.647000")
        assert result.gross_financial_liability_eur == _D("32.35")
        assert result.net_financial_liability_eur == _D("32.35")
        assert result.cbam_certificates == 1  # ceil(0.647) = 1

    def test_certificates_ceil(self):
        """Certificates must be rounded up per Art. 22(5)."""
        # 1.001 tCO2e liability → 2 certificates
        result = compute_cbam_liability(
            goods_lines=[_make_line(net_mass_kg=1549.46, direct_kgco2e=1000.0, indirect_kgco2e=1.46)],
            eu_ets_price_eur=_D("60"),
            carbon_price_paid_eur=_D("0"),
        )
        # embedded = (1000+1.46)/1549.46 * 1.54946... just check ceil applied
        assert result.cbam_certificates == math.ceil(float(result.net_liability_tco2e))

    def test_carbon_price_deduction(self):
        """Carbon price paid halves the liability when CP = ETS/2."""
        result = compute_cbam_liability(
            goods_lines=[_make_line(net_mass_kg=1000.0, direct_kgco2e=1000.0, indirect_kgco2e=0.0)],
            eu_ets_price_eur=_D("60"),
            carbon_price_paid_eur=_D("30"),  # 50 % of ETS price
        )
        # embedded = 1000/1000 = 1.0 tCO2e
        # deduction = (30/60) × 1.0 = 0.5 tCO2e
        # net = 0.5
        assert result.total_embedded_tco2e == _D("1.000000")
        assert result.carbon_price_deduction_tco2e == _D("0.500000")
        assert result.net_liability_tco2e == _D("0.500000")
        assert result.net_financial_liability_eur == _D("30.00")
        assert result.cbam_certificates == 1  # ceil(0.5) = 1

    def test_full_deduction_never_negative(self):
        """When carbon_price_paid >= eu_ets_price, net liability must be 0."""
        result = compute_cbam_liability(
            goods_lines=[_make_line(net_mass_kg=1000.0, direct_kgco2e=1000.0, indirect_kgco2e=0.0)],
            eu_ets_price_eur=_D("50"),
            carbon_price_paid_eur=_D("80"),  # higher than ETS
        )
        # deduction_ratio = 80/50 = 1.6 → deduction = 1.6 tCO2e > 1.0 tCO2e
        # net = max(0, 1.0 - 1.6) = 0
        assert result.net_liability_tco2e == _D("0")
        assert result.cbam_certificates == 0
        assert result.net_financial_liability_eur == _D("0.00")

    def test_multiple_goods_lines_summed(self):
        """Total embedded = sum of per-line embedded tCO2e."""
        lines = [
            _make_line("gl-1", net_mass_kg=1000.0, direct_kgco2e=633.0, indirect_kgco2e=0.0),
            _make_line("gl-2", net_mass_kg=2000.0, direct_kgco2e=1266.0, indirect_kgco2e=0.0),
        ]
        result = compute_cbam_liability(
            goods_lines=lines,
            eu_ets_price_eur=_D("50"),
            carbon_price_paid_eur=_D("0"),
        )
        # Line 1: 633/1000 = 0.633 tCO2e/t × 1 t = 0.633 tCO2e
        # Line 2: 1266/2000 = 0.633 tCO2e/t × 2 t = 1.266 tCO2e
        # Total = 1.899 tCO2e
        assert result.total_embedded_tco2e == _D("1.899000")
        assert len(result.goods_lines) == 2
        assert result.total_net_mass_t == _D("3.000000")

    def test_zero_mass_line_skipped(self):
        """A goods line with net_mass_kg=0 contributes 0 tCO2e and no SEE error."""
        result = compute_cbam_liability(
            goods_lines=[
                _make_line("gl-ok", net_mass_kg=1000.0, direct_kgco2e=500.0, indirect_kgco2e=0.0),
                {
                    "goods_line_id": "gl-zero",
                    "cn_code": "7208",
                    "net_mass_kg": _D("0"),
                    "direct_kgco2e": _D("0"),
                    "indirect_kgco2e": _D("0"),
                },
            ],
            eu_ets_price_eur=_D("50"),
        )
        assert len(result.goods_lines) == 2
        zero_line = next(gl for gl in result.goods_lines if gl.goods_line_id == "gl-zero")
        assert zero_line.embedded_tco2e == _D("0")
        assert zero_line.see_total_tco2e_per_t == _D("0")

    def test_raises_on_zero_ets_price(self):
        with pytest.raises(ValueError, match="eu_ets_price_eur must be > 0"):
            compute_cbam_liability(
                goods_lines=[_make_line()],
                eu_ets_price_eur=_D("0"),
            )

    def test_raises_on_negative_ets_price(self):
        with pytest.raises(ValueError, match="eu_ets_price_eur must be > 0"):
            compute_cbam_liability(
                goods_lines=[_make_line()],
                eu_ets_price_eur=_D("-10"),
            )

    def test_raises_on_negative_carbon_price(self):
        with pytest.raises(ValueError, match="carbon_price_paid_eur must be >= 0"):
            compute_cbam_liability(
                goods_lines=[_make_line()],
                eu_ets_price_eur=_D("50"),
                carbon_price_paid_eur=_D("-5"),
            )

    def test_regulation_refs_populated(self):
        result = compute_cbam_liability(
            goods_lines=[_make_line()],
            eu_ets_price_eur=_D("50"),
        )
        assert any("2023/956" in ref for ref in result.regulation_refs)
        assert any("2023/1773" in ref for ref in result.regulation_refs)

    def test_gross_vs_net_financial_liability(self):
        """Gross uses total_embedded; net uses net_liability after deduction."""
        result = compute_cbam_liability(
            goods_lines=[_make_line(net_mass_kg=1000.0, direct_kgco2e=1000.0, indirect_kgco2e=0.0)],
            eu_ets_price_eur=_D("60"),
            carbon_price_paid_eur=_D("20"),
        )
        # embedded = 1.0 tCO2e; deduction = 20/60 ≈ 0.3333; net ≈ 0.6667
        assert result.gross_financial_liability_eur == (result.total_embedded_tco2e * _D("60")).quantize(_D("0.01"))
        assert result.net_financial_liability_eur == (result.net_liability_tco2e * _D("60")).quantize(_D("0.01"))
        assert result.gross_financial_liability_eur > result.net_financial_liability_eur

    def test_per_line_see_values(self):
        """GoodsLineSEE has correct SEE and embedded values."""
        result = compute_cbam_liability(
            goods_lines=[_make_line(net_mass_kg=2000.0, direct_kgco2e=1000.0, indirect_kgco2e=200.0)],
            eu_ets_price_eur=_D("50"),
        )
        gl = result.goods_lines[0]
        # see_d = 1000/2000 = 0.5 tCO2e/t; see_i = 200/2000 = 0.1; see_t = 0.6
        assert gl.see_direct_tco2e_per_t == _D("0.500000")
        assert gl.see_indirect_tco2e_per_t == _D("0.100000")
        assert gl.see_total_tco2e_per_t == _D("0.600000")
        # embedded = 0.6 × 2 t = 1.2 tCO2e
        assert gl.embedded_tco2e == _D("1.200000")
