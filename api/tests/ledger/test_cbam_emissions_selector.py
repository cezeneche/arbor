"""Tests for cbam_emissions_selector.py — automated method selection engine.

Tests cover:
  - Path 1: actual method when supplier provides direct + indirect at threshold confidence
  - Path 2: estimated method when only direct is present (indirect gap-filled from Annex VI)
  - Path 3: default method when supplier data is absent
  - Path 4: default method when confidence is below threshold
  - Path 5: extreme value detection → downgrade to default
  - Path 6: force_method override
  - Path 7: select_for_goods_line() convenience wrapper
  - SEE calculation correctness
  - Evidence trace completeness
  - Regulation references in output
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from ledger_app.services.cbam_emissions_selector import (
    ACTUAL_QUALITY_THRESHOLD,
    METHOD_ACTUAL,
    METHOD_DEFAULT,
    METHOD_ESTIMATED,
    PLAUSIBILITY_EXTREME_MULTIPLE,
    MethodSelectionResult,
    SelectionEvidenceAtom,
    select_and_calculate,
    select_for_goods_line,
)

_D = Decimal

# ── Fixtures ───────────────────────────────────────────────────────────────────

# Grey Portland cement CN 25232900 — Annex VI default direct=0.810 tCO2e/t
_CEMENT_CN = "25232900"
_STEEL_CN = "72081000"   # Hot-rolled coil iron/steel

# 10 tonnes at 0.810 tCO2e/t direct default → 8100 kgCO2e direct
_CEMENT_MASS_KG = _D("10000")
_CEMENT_DEFAULT_DIRECT_KG = _D("8100")    # 0.810 × 10000

_HIGH_CONFIDENCE = ACTUAL_QUALITY_THRESHOLD + 0.1   # 0.70 if threshold=0.60
_LOW_CONFIDENCE = ACTUAL_QUALITY_THRESHOLD - 0.1    # 0.50


# ── Path 1: Actual method ──────────────────────────────────────────────────────

class TestActualMethod:
    def test_actual_selected_when_both_values_at_confidence(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=_D("500"),
            supplier_direct_confidence=_HIGH_CONFIDENCE,
            supplier_indirect_confidence=_HIGH_CONFIDENCE,
        )
        assert result.method == METHOD_ACTUAL

    def test_actual_uses_supplier_direct(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=_D("500"),
            supplier_direct_confidence=_HIGH_CONFIDENCE,
            supplier_indirect_confidence=_HIGH_CONFIDENCE,
        )
        assert result.direct_kgco2e == _D("8000")

    def test_actual_uses_supplier_indirect(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=_D("500"),
            supplier_direct_confidence=_HIGH_CONFIDENCE,
            supplier_indirect_confidence=_HIGH_CONFIDENCE,
        )
        assert result.indirect_kgco2e == _D("500")

    def test_actual_annex_vi_not_used(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=_D("500"),
            supplier_direct_confidence=_HIGH_CONFIDENCE,
            supplier_indirect_confidence=_HIGH_CONFIDENCE,
        )
        assert result.annex_vi_factor_used is False

    def test_actual_trace_contains_select_method_step(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=_D("500"),
            supplier_direct_confidence=_HIGH_CONFIDENCE,
            supplier_indirect_confidence=_HIGH_CONFIDENCE,
        )
        steps = [a.step for a in result.decision_trace]
        assert "select_method" in steps
        method_atom = next(a for a in result.decision_trace if a.step == "select_method")
        assert method_atom.outcome == METHOD_ACTUAL


# ── Path 2: Estimated method (indirect gap-fill) ───────────────────────────────

class TestEstimatedMethod:
    def test_estimated_when_no_indirect(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=None,
            supplier_direct_confidence=_HIGH_CONFIDENCE,
            supplier_indirect_confidence=0.0,
        )
        assert result.method == METHOD_ESTIMATED

    def test_estimated_indirect_is_annex_vi_value(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=None,
            supplier_direct_confidence=_HIGH_CONFIDENCE,
            supplier_indirect_confidence=0.0,
        )
        # indirect gap-filled from Annex VI — must be ≥ 0
        assert result.indirect_kgco2e >= _D("0")

    def test_estimated_direct_is_supplier_value(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=None,
            supplier_direct_confidence=_HIGH_CONFIDENCE,
            supplier_indirect_confidence=0.0,
        )
        assert result.direct_kgco2e == _D("8000")

    def test_estimated_warns_about_gap_fill(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=None,
            supplier_direct_confidence=_HIGH_CONFIDENCE,
            supplier_indirect_confidence=0.0,
        )
        assert any("indirect_gap_filled" in w for w in result.warnings)

    def test_estimated_annex_vi_used(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=None,
            supplier_direct_confidence=_HIGH_CONFIDENCE,
            supplier_indirect_confidence=0.0,
        )
        assert result.annex_vi_factor_used is True

    def test_estimated_when_indirect_below_threshold(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=_D("300"),
            supplier_direct_confidence=_HIGH_CONFIDENCE,
            supplier_indirect_confidence=_LOW_CONFIDENCE,  # below threshold
        )
        assert result.method == METHOD_ESTIMATED


# ── Path 3: Default method (no supplier data) ──────────────────────────────────

class TestDefaultMethod:
    def test_default_when_no_supplier_data(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=None,
            indirect_kgco2e_supplier=None,
        )
        assert result.method == METHOD_DEFAULT

    def test_default_uses_annex_vi_direct(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=None,
            indirect_kgco2e_supplier=None,
        )
        # Annex VI cement default direct = 0.810 tCO2e/t × 10000 kg = 8100 kgCO2e
        assert float(result.direct_kgco2e) == pytest.approx(float(_CEMENT_DEFAULT_DIRECT_KG), rel=1e-3)

    def test_default_annex_vi_flag_set(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
        )
        assert result.annex_vi_factor_used is True

    def test_default_trace_has_annex_vi_step(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
        )
        steps = [a.step for a in result.decision_trace]
        assert "annex_vi_lookup" in steps

    def test_default_warns_when_no_factor_available(self):
        # Use a CN code not in the Annex VI table
        result = select_and_calculate(
            cn_code="99999999",  # Not a real CBAM CN code
            net_mass_kg=_D("1000"),
        )
        assert result.method == METHOD_DEFAULT
        assert result.direct_kgco2e == _D("0")
        assert any("no_default_factor" in w for w in result.warnings)


# ── Path 4: Confidence below threshold ────────────────────────────────────────

class TestLowConfidence:
    def test_low_confidence_falls_back_to_default(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            supplier_direct_confidence=_LOW_CONFIDENCE,  # below threshold
        )
        assert result.method == METHOD_DEFAULT

    def test_zero_confidence_falls_back_to_default(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            supplier_direct_confidence=0.0,
        )
        assert result.method == METHOD_DEFAULT


# ── Path 5: Extreme value detection ───────────────────────────────────────────

class TestExtremeValueDetection:
    def test_extreme_direct_downgrades_to_default(self):
        # Default direct for cement = 8100 kgCO2e for 10t
        # Extreme threshold = 10× → > 81000 kgCO2e would trigger
        extreme_direct = _CEMENT_DEFAULT_DIRECT_KG * _D(str(PLAUSIBILITY_EXTREME_MULTIPLE + 1))
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=extreme_direct,
            supplier_direct_confidence=_HIGH_CONFIDENCE,
        )
        assert result.method == METHOD_DEFAULT

    def test_extreme_value_generates_warning(self):
        extreme_direct = _CEMENT_DEFAULT_DIRECT_KG * _D(str(PLAUSIBILITY_EXTREME_MULTIPLE + 1))
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=extreme_direct,
            supplier_direct_confidence=_HIGH_CONFIDENCE,
        )
        assert any("extreme_value" in w for w in result.warnings)

    def test_plausible_deviation_warns_but_keeps_actual(self):
        # 30% above default — plausibility warning but still actual
        slightly_high = _CEMENT_DEFAULT_DIRECT_KG * _D("1.35")
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=slightly_high,
            indirect_kgco2e_supplier=_D("400"),
            supplier_direct_confidence=_HIGH_CONFIDENCE,
            supplier_indirect_confidence=_HIGH_CONFIDENCE,
        )
        assert result.method == METHOD_ACTUAL
        assert any("plausibility_deviation" in w for w in result.warnings)


# ── Path 6: force_method override ─────────────────────────────────────────────

class TestForceMethod:
    def test_force_actual_honours_supplier_values(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=_D("400"),
            force_method=METHOD_ACTUAL,
        )
        assert result.method == METHOD_ACTUAL
        assert result.direct_kgco2e == _D("8000")

    def test_force_default_ignores_supplier_values(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=_D("400"),
            force_method=METHOD_DEFAULT,
        )
        assert result.method == METHOD_DEFAULT
        # Should use Annex VI, not the supplier 8000
        assert float(result.direct_kgco2e) == pytest.approx(float(_CEMENT_DEFAULT_DIRECT_KG), rel=1e-3)

    def test_force_estimated_uses_supplied_values(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("7500"),
            indirect_kgco2e_supplier=_D("300"),
            force_method=METHOD_ESTIMATED,
        )
        assert result.method == METHOD_ESTIMATED
        assert result.direct_kgco2e == _D("7500")

    def test_force_records_override_in_trace(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            force_method=METHOD_ACTUAL,
        )
        steps = [a.step for a in result.decision_trace]
        assert "force_method" in steps


# ── SEE calculation correctness ────────────────────────────────────────────────

class TestSEECalculation:
    def test_see_formula_direct(self):
        # direct=10000 kgCO2e, mass=10000 kg → SEE_direct = 10000/10000 = 1.0 tCO2e/t
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_D("10000"),
            direct_kgco2e_supplier=_D("10000"),
            indirect_kgco2e_supplier=_D("0"),
            supplier_direct_confidence=_HIGH_CONFIDENCE,
            supplier_indirect_confidence=_HIGH_CONFIDENCE,
        )
        assert float(result.see_direct_tco2e_per_t) == pytest.approx(1.0, rel=1e-4)

    def test_see_total_is_direct_plus_indirect(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_D("10000"),
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=_D("2000"),
            supplier_direct_confidence=_HIGH_CONFIDENCE,
            supplier_indirect_confidence=_HIGH_CONFIDENCE,
        )
        assert result.see_total_tco2e_per_t == result.see_direct_tco2e_per_t + result.see_indirect_tco2e_per_t

    def test_embedded_tco2e_calculation(self):
        # direct=8000, indirect=2000, mass=10000 → SEE=1.0 tCO2e/t × 10t = 10 tCO2e
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_D("10000"),
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=_D("2000"),
            supplier_direct_confidence=_HIGH_CONFIDENCE,
            supplier_indirect_confidence=_HIGH_CONFIDENCE,
        )
        assert float(result.embedded_tco2e) == pytest.approx(10.0, rel=1e-3)

    def test_zero_mass_returns_zero_see(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_D("0"),
        )
        assert result.see_total_tco2e_per_t == _D("0")
        assert result.embedded_tco2e == _D("0")

    def test_default_see_matches_annex_vi_reference(self):
        # Cement default = 0.810 direct tCO2e/t → for 10t = 8100 kgCO2e
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_D("10000"),
        )
        assert float(result.see_direct_tco2e_per_t) == pytest.approx(0.810, rel=1e-3)


# ── Result type completeness ───────────────────────────────────────────────────

class TestResultType:
    def test_result_is_correct_type(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
        )
        assert isinstance(result, MethodSelectionResult)

    def test_decision_trace_is_list_of_atoms(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
        )
        assert isinstance(result.decision_trace, list)
        assert all(isinstance(a, SelectionEvidenceAtom) for a in result.decision_trace)

    def test_decision_trace_not_empty(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
        )
        assert len(result.decision_trace) > 0

    def test_regulation_refs_present(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
        )
        refs = " ".join(result.regulation_refs)
        assert "2023/1773" in refs
        assert "Art" in refs or "Article" in refs

    def test_factor_metadata_present(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
        )
        assert "regulation" in result.factor_metadata
        assert "table_version" in result.factor_metadata

    def test_cn_code_echoed_in_result(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
        )
        assert result.cn_code == _CEMENT_CN

    def test_net_mass_kg_echoed_in_result(self):
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
        )
        assert result.net_mass_kg == _CEMENT_MASS_KG


# ── Evidence atom confidence derivation ───────────────────────────────────────

class TestConfidenceFromEvidence:
    def test_derives_confidence_from_evidence_atoms(self):
        # Pass high-confidence evidence atoms instead of explicit confidence
        evidence = [
            {
                "field": "lines[0].direct_embedded_kgco2e",
                "value": 8000.0,
                "confidence": _HIGH_CONFIDENCE,
                "source": "regex",
            },
            {
                "field": "lines[0].indirect_embedded_kgco2e",
                "value": 400.0,
                "confidence": _HIGH_CONFIDENCE,
                "source": "regex",
            },
        ]
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            indirect_kgco2e_supplier=_D("400"),
            evidence=evidence,
            # No explicit confidence — should derive from evidence
        )
        assert result.method == METHOD_ACTUAL

    def test_low_confidence_evidence_falls_back(self):
        evidence = [
            {
                "field": "lines[0].direct_embedded_kgco2e",
                "value": 8000.0,
                "confidence": _LOW_CONFIDENCE,  # below threshold
                "source": "llm",
            },
        ]
        result = select_and_calculate(
            cn_code=_CEMENT_CN,
            net_mass_kg=_CEMENT_MASS_KG,
            direct_kgco2e_supplier=_D("8000"),
            evidence=evidence,
        )
        assert result.method == METHOD_DEFAULT


# ── select_for_goods_line convenience wrapper ──────────────────────────────────

class TestSelectForGoodsLine:
    def test_returns_method_selection_result(self):
        gl = {
            "cn_code": _CEMENT_CN,
            "net_mass_kg": 10000.0,
            "direct_embedded_kgco2e": None,
            "indirect_embedded_kgco2e": None,
            "method": None,
            "evidence": [],
        }
        result = select_for_goods_line(gl)
        assert isinstance(result, MethodSelectionResult)

    def test_default_when_no_emissions(self):
        gl = {
            "cn_code": _CEMENT_CN,
            "net_mass_kg": 10000.0,
            "direct_embedded_kgco2e": None,
            "indirect_embedded_kgco2e": None,
            "method": None,
            "evidence": [],
        }
        result = select_for_goods_line(gl)
        assert result.method == METHOD_DEFAULT

    def test_honours_declared_method_actual(self):
        gl = {
            "cn_code": _CEMENT_CN,
            "net_mass_kg": 10000.0,
            "direct_embedded_kgco2e": 8000.0,
            "indirect_embedded_kgco2e": 400.0,
            "method": "actual",
            "evidence": [],
        }
        result = select_for_goods_line(gl)
        assert result.method == METHOD_ACTUAL

    def test_uses_quantity_fallback_for_mass(self):
        # "quantity" instead of "net_mass_kg"
        gl = {
            "cn_code": _CEMENT_CN,
            "quantity": 10000.0,
            "net_mass_kg": None,
            "direct_embedded_kgco2e": None,
            "indirect_embedded_kgco2e": None,
            "method": None,
            "evidence": [],
        }
        result = select_for_goods_line(gl)
        assert result.net_mass_kg == _D("10000.0")

    def test_steel_cn_code_uses_steel_defaults(self):
        gl = {
            "cn_code": _STEEL_CN,
            "net_mass_kg": 5000.0,
            "direct_embedded_kgco2e": None,
            "indirect_embedded_kgco2e": None,
            "method": None,
            "evidence": [],
        }
        result = select_for_goods_line(gl)
        assert result.method == METHOD_DEFAULT
        # Steel default SEE > 0 (world average ~1.9 tCO2e/t)
        assert result.see_direct_tco2e_per_t > _D("0")
