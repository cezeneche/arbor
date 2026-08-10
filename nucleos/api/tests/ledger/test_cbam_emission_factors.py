"""Tests for cbam_emission_factors — EU 2023/1773 Art.4(3) default SEE tables.

Coverage:
- All six CBAM sectors: cement, iron_steel (Ch.72 + Ch.73), aluminium,
  fertilisers, electricity, hydrogen
- Production-route resolution (BF_BOF, EAF, DRI_EAF, primary, secondary,
  SMR, COAL_GAS, ELECTRO, WORLD_AVG)
- Prefix fallback (8-digit → 6-digit → 4-digit → 2-digit chapter)
- Per-heading Ch.73 entries (not a single chapter fallback)
- Out-of-scope CN codes return None
- compute_see_from_defaults mass conversion (kg → t)
- validate_against_defaults:
    - method="default" deviation warnings
    - method="actual" plausibility (too low / too high)
    - method="estimated" produces no factor warning
    - no Annex VI entry → warning for method="default"
- ELECTRICITY_FACTORS country lookup
- TABLE_VERSION constant present
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from ledger_app.services.cbam_emission_factors import (
    ELECTRICITY_FACTORS,
    PRODUCTION_ROUTE_BF_BOF,
    PRODUCTION_ROUTE_COAL_GAS,
    PRODUCTION_ROUTE_DRI_EAF,
    PRODUCTION_ROUTE_EAF,
    PRODUCTION_ROUTE_ELECTRO,
    PRODUCTION_ROUTE_PRIMARY,
    PRODUCTION_ROUTE_SECONDARY,
    PRODUCTION_ROUTE_SMR,
    PRODUCTION_ROUTE_WORLD_AVG,
    TABLE_VERSION,
    DefaultSEE,
    compute_see_from_defaults,
    get_default_see,
    validate_against_defaults,
)

_D = Decimal


# ── TABLE_VERSION ─────────────────────────────────────────────────────────────

class TestTableVersion:
    def test_table_version_is_2023(self):
        assert TABLE_VERSION == "2023"


# ── Cement ────────────────────────────────────────────────────────────────────
# All values: EC DG TAXUD Art.4(3) operative table, Dec 2023.

class TestCementFactors:
    def test_portland_cement_grey(self):
        see = get_default_see("25232900")
        assert see is not None
        assert see.sector == "cement"
        assert see.direct_tco2e_per_t == _D("0.810")

    def test_cement_clinker(self):
        see = get_default_see("25231000")
        assert see is not None
        assert see.direct_tco2e_per_t == _D("0.830")

    def test_white_portland_cement(self):
        see = get_default_see("25232100")
        assert see is not None
        assert see.direct_tco2e_per_t == _D("1.160")

    def test_aluminous_cement(self):
        see = get_default_see("25233000")
        assert see is not None
        assert see.direct_tco2e_per_t == _D("1.750")

    def test_calcined_kaolin(self):
        see = get_default_see("25070080")
        assert see is not None
        assert see.sector == "cement"

    def test_total_tco2e_per_t_property(self):
        see = get_default_see("25232900")
        assert see is not None
        assert see.total_tco2e_per_t == see.direct_tco2e_per_t + see.indirect_tco2e_per_t


# ── Iron and Steel ─────────────────────────────────────────────────────────────
# production_route=None → official world-average default.
# BF_BOF / EAF entries → engineering estimates for actual-measurement use.

class TestIronSteelFactors:
    def test_pig_iron_bf_bof(self):
        # Engineering estimate, not the official default
        see = get_default_see("72011000", PRODUCTION_ROUTE_BF_BOF)
        assert see is not None
        assert see.sector == "iron_steel"
        assert see.direct_tco2e_per_t == _D("2.200")

    def test_pig_iron_world_avg(self):
        # WORLD_AVG falls through to the None (world-average) entry
        see = get_default_see("7201", PRODUCTION_ROUTE_WORLD_AVG)
        assert see is not None
        assert see.direct_tco2e_per_t == _D("1.900")

    def test_semi_finished_eaf(self):
        # Engineering estimate for EAF route
        see = get_default_see("72071000", PRODUCTION_ROUTE_EAF)
        assert see is not None
        assert see.direct_tco2e_per_t == _D("0.610")

    def test_semi_finished_bf_bof(self):
        # Engineering estimate for BF-BOF route
        see = get_default_see("72071000", PRODUCTION_ROUTE_BF_BOF)
        assert see is not None
        assert see.direct_tco2e_per_t == _D("2.440")

    def test_dri_eaf_sponge_iron(self):
        # Engineering estimate for DRI-EAF route
        see = get_default_see("72031000", PRODUCTION_ROUTE_DRI_EAF)
        assert see is not None
        assert see.direct_tco2e_per_t == _D("0.900")

    def test_ferrous_scrap_no_route(self):
        see = get_default_see("72041000")
        assert see is not None
        assert see.direct_tco2e_per_t == _D("0.030")

    def test_stainless_steel_eaf(self):
        # Official hot-rolled stainless value; EAF is the dominant route for SS
        see = get_default_see("72191000", PRODUCTION_ROUTE_EAF)
        assert see is not None
        assert see.direct_tco2e_per_t == _D("2.180")

    def test_flat_rolled_hot_rolled_eaf(self):
        # Engineering estimate for EAF route
        see = get_default_see("72081000", PRODUCTION_ROUTE_EAF)
        assert see is not None
        assert see.direct_tco2e_per_t == _D("0.650")

    def test_ch73_per_heading_7308(self):
        # Heading 7308 (fabricated structures) has its own per-heading entry
        see = get_default_see("73081000")
        assert see is not None
        assert see.sector == "iron_steel"
        assert see.direct_tco2e_per_t == _D("2.460")

    def test_ch73_stainless_screws_731812(self):
        # 7318 12 10 is the stainless screw sub-heading (8-digit prefix entry)
        see = get_default_see("73181210")
        assert see is not None
        assert see.direct_tco2e_per_t == _D("2.100")

    def test_ch73_non_stainless_screws_731815(self):
        # 7318 15 is non-stainless bolts/screws — falls back to 4-digit 7318 entry
        see = get_default_see("73181500")
        assert see is not None
        assert see.direct_tco2e_per_t == _D("1.890")

    def test_no_route_falls_back_to_none_entry(self):
        # When no route given, should return the None-route fallback for ferrous scrap
        see = get_default_see("72040000")
        assert see is not None
        assert see.production_route is None

    def test_source_ref_cites_annex_vi(self):
        see = get_default_see("72081000", PRODUCTION_ROUTE_BF_BOF)
        assert see is not None
        assert "2023/1773" in see.source_ref


# ── Aluminium ─────────────────────────────────────────────────────────────────

class TestAluminiumFactors:
    def test_unwrought_primary(self):
        # Official world-average (also tagged as PRIMARY route)
        see = get_default_see("76011000", PRODUCTION_ROUTE_PRIMARY)
        assert see is not None
        assert see.sector == "aluminium"
        assert see.direct_tco2e_per_t == _D("2.360")
        assert see.indirect_tco2e_per_t == _D("8.140")

    def test_unwrought_secondary(self):
        # Engineering estimate; SECONDARY not in official table
        see = get_default_see("76011000", PRODUCTION_ROUTE_SECONDARY)
        assert see is not None
        assert see.direct_tco2e_per_t == _D("0.327")

    def test_aluminium_scrap(self):
        see = get_default_see("76021000")
        assert see is not None
        assert see.direct_tco2e_per_t == _D("0.050")

    def test_aluminium_wire_primary(self):
        see = get_default_see("76051100", PRODUCTION_ROUTE_PRIMARY)
        assert see is not None
        assert see.sector == "aluminium"

    def test_ch76_fallback_primary(self):
        # Heading 7616 — other articles; falls back to chapter-76 entry
        see = get_default_see("76161000", PRODUCTION_ROUTE_PRIMARY)
        assert see is not None
        assert see.sector == "aluminium"

    def test_ch76_fallback_secondary(self):
        see = get_default_see("76161000", PRODUCTION_ROUTE_SECONDARY)
        assert see is not None
        assert see.direct_tco2e_per_t == _D("0.420")


# ── Fertilisers ───────────────────────────────────────────────────────────────

class TestFertilisersFactors:
    def test_anhydrous_ammonia(self):
        see = get_default_see("28141000")
        assert see is not None
        assert see.sector == "fertilisers"
        assert see.direct_tco2e_per_t == _D("2.680")

    def test_urea(self):
        see = get_default_see("31021000")
        assert see is not None
        assert see.direct_tco2e_per_t == _D("1.780")

    def test_ammonium_nitrate(self):
        see = get_default_see("31023090")
        assert see is not None
        assert see.direct_tco2e_per_t == _D("2.320")

    def test_ammonium_sulphate(self):
        see = get_default_see("31022100")
        assert see is not None
        assert see.direct_tco2e_per_t == _D("0.860")

    def test_diammonium_phosphate(self):
        see = get_default_see("31053000")
        assert see is not None
        assert see.direct_tco2e_per_t == _D("0.690")

    def test_npk_fertiliser(self):
        see = get_default_see("31052010")
        assert see is not None
        assert see.direct_tco2e_per_t == _D("1.230")

    def test_nitric_acid(self):
        see = get_default_see("28080000")
        assert see is not None
        assert see.direct_tco2e_per_t == _D("2.560")

    def test_ch3105_fallback(self):
        # Heading 31059091 — uses chapter fallback
        see = get_default_see("31059091")
        assert see is not None
        assert see.sector == "fertilisers"


# ── Electricity ───────────────────────────────────────────────────────────────

class TestElectricityFactors:
    def test_world_average(self):
        see = get_default_see("27160000")
        assert see is not None
        assert see.sector == "electricity"
        assert see.direct_tco2e_per_t == _D("0.493")

    def test_electricity_factors_has_eu_countries(self):
        for iso2 in ("DE", "FR", "PL", "SE", "NO"):
            assert iso2 in ELECTRICITY_FACTORS, f"Missing {iso2}"

    def test_france_low_nuclear(self):
        assert ELECTRICITY_FACTORS["FR"] < _D("0.10")

    def test_poland_coal_intensive(self):
        assert ELECTRICITY_FACTORS["PL"] > _D("0.70")

    def test_south_africa_high(self):
        assert ELECTRICITY_FACTORS["ZA"] > _D("0.80")

    def test_world_fallback_in_factors(self):
        assert "WORLD" in ELECTRICITY_FACTORS
        assert ELECTRICITY_FACTORS["WORLD"] == _D("0.493")


# ── Hydrogen ──────────────────────────────────────────────────────────────────

class TestHydrogenFactors:
    def test_smr_default(self):
        # Engineering estimate for SMR route
        see = get_default_see("28041000", PRODUCTION_ROUTE_SMR)
        assert see is not None
        assert see.sector == "hydrogen"
        assert see.direct_tco2e_per_t == _D("9.000")

    def test_coal_gasification(self):
        # Engineering estimate for coal gasification
        see = get_default_see("28041000", PRODUCTION_ROUTE_COAL_GAS)
        assert see is not None
        assert see.direct_tco2e_per_t == _D("19.000")

    def test_electrolysis(self):
        see = get_default_see("28041000", PRODUCTION_ROUTE_ELECTRO)
        assert see is not None
        assert see.direct_tco2e_per_t == _D("0.000")

    def test_no_route_returns_official_world_average(self):
        # Official Art. 4(3) default: 10.4 tCO2e/t world average (JRC 2023 H2 mix)
        see = get_default_see("28041000")
        assert see is not None
        assert see.direct_tco2e_per_t == _D("10.400")


# ── Out-of-scope CN codes ─────────────────────────────────────────────────────

class TestOutOfScope:
    def test_plastics_no_default(self):
        assert get_default_see("39011000") is None

    def test_textiles_no_default(self):
        assert get_default_see("52010000") is None

    def test_empty_string(self):
        assert get_default_see("") is None


# ── Prefix fallback resolution ────────────────────────────────────────────────

class TestPrefixResolution:
    def test_8digit_match_returns_specific_entry(self):
        # 25232900 (grey Portland) and 25232100 (white Portland) both have
        # their own 8-digit entries with different SEE values.
        see_grey = get_default_see("25232900")
        see_white = get_default_see("25232100")
        assert see_grey is not None
        assert see_white is not None
        # They are distinct entries with different values
        assert see_grey.direct_tco2e_per_t != see_white.direct_tco2e_per_t

    def test_4digit_cement_heading_no_annex_vi_entry(self):
        # Annex VI requires knowing the specific cement subheading (clinker,
        # white Portland, grey Portland, aluminous) — heading-only "2523" has
        # no single representative SEE value and correctly returns None.
        assert get_default_see("2523") is None

    def test_4digit_heading_matches_iron_steel(self):
        see = get_default_see("7208", PRODUCTION_ROUTE_BF_BOF)
        assert see is not None
        assert see.sector == "iron_steel"

    def test_2digit_chapter_fallback_iron_steel(self):
        # 7326 has a per-heading entry; lookup falls to 4-digit "7326" None entry
        see = get_default_see("73260000", PRODUCTION_ROUTE_BF_BOF)
        assert see is not None
        assert see.sector == "iron_steel"


# ── compute_see_from_defaults ─────────────────────────────────────────────────

class TestComputeSEE:
    def test_cement_1000_kg(self):
        result = compute_see_from_defaults("25232900", _D("1000"))
        assert result is not None
        direct, indirect = result
        # 1000 kg = 1 t × 0.810 tCO2e/t = 0.810 tCO2e
        assert direct == _D("0.810")

    def test_cement_500_kg(self):
        result = compute_see_from_defaults("25232900", _D("500"))
        assert result is not None
        direct, indirect = result
        # 500 kg = 0.5 t × 0.810 = 0.405 tCO2e
        assert direct == _D("0.405")

    def test_pig_iron_bf_bof_10_tonnes(self):
        result = compute_see_from_defaults("72011000", _D("10000"), PRODUCTION_ROUTE_BF_BOF)
        assert result is not None
        direct, indirect = result
        # 10000 kg = 10 t × 2.200 tCO2e/t = 22.000 tCO2e
        assert direct == _D("22.000")

    def test_urea_2000_kg(self):
        result = compute_see_from_defaults("31021000", _D("2000"))
        assert result is not None
        direct, indirect = result
        # 2000 kg = 2 t × 1.780 tCO2e/t = 3.560 tCO2e
        assert direct == _D("3.560")

    def test_hydrogen_smr_500_kg(self):
        result = compute_see_from_defaults("28041000", _D("500"), PRODUCTION_ROUTE_SMR)
        assert result is not None
        direct, _ = result
        # 500 kg = 0.5 t × 9.0 = 4.5 tCO2e
        assert direct == _D("4.500")

    def test_out_of_scope_returns_none(self):
        assert compute_see_from_defaults("39011000", _D("1000")) is None


# ── validate_against_defaults ─────────────────────────────────────────────────
# Grey Portland cement (25232900) has official default 0.810 tCO2e/t.

class TestValidateAgainstDefaults:
    # ── method="default" ──────────────────────────────────────────────────────

    def test_default_method_no_deviation_no_warning(self):
        # Submit exact Annex VI value → no warning
        # Portland cement: 0.810 tCO2e/t → for 1000 kg = 0.810 tCO2e
        vr = validate_against_defaults(
            "25232900", "default",
            direct_kgco2e=_D("0.810"),
            net_mass_kg=_D("1000"),
        )
        assert vr.warnings == []
        assert vr.default_see is not None

    def test_default_method_small_deviation_no_warning(self):
        # 10 % deviation is within the 20 % threshold
        vr = validate_against_defaults(
            "25232900", "default",
            direct_kgco2e=_D("0.810") * _D("1.10"),
            net_mass_kg=_D("1000"),
        )
        assert vr.warnings == []

    def test_default_method_large_deviation_warns(self):
        # 50 % deviation exceeds the 20 % threshold
        vr = validate_against_defaults(
            "25232900", "default",
            direct_kgco2e=_D("0.810") * _D("1.50"),  # +50%
            net_mass_kg=_D("1000"),
        )
        assert len(vr.warnings) == 1
        assert "cbam_factors:default_deviation" in vr.warnings[0]
        assert "25232900" in vr.warnings[0]

    def test_default_method_no_submitted_value_no_warning(self):
        # No submitted value → caller will auto-compute; no warning needed
        vr = validate_against_defaults(
            "25232900", "default",
            direct_kgco2e=None,
            net_mass_kg=_D("1000"),
        )
        assert vr.warnings == []
        assert vr.computed_direct_kgco2e is not None

    def test_default_method_no_annex_vi_entry_warns(self):
        vr = validate_against_defaults(
            "39011000", "default",
            direct_kgco2e=None,
            net_mass_kg=_D("1000"),
        )
        assert len(vr.warnings) == 1
        assert "no_default_factor" in vr.warnings[0]

    def test_default_method_custom_threshold(self):
        # 15 % deviation: above 10 % custom threshold → warning
        vr = validate_against_defaults(
            "25232900", "default",
            direct_kgco2e=_D("0.810") * _D("1.15"),
            net_mass_kg=_D("1000"),
            deviation_threshold_pct=_D("10"),
        )
        assert len(vr.warnings) == 1

    # ── method="actual" ───────────────────────────────────────────────────────

    def test_actual_method_plausible_no_warning(self):
        # Within 5 %–1000 % of default → no warning
        vr = validate_against_defaults(
            "25232900", "actual",
            direct_kgco2e=_D("0.700"),  # ~86 % of 0.810 default
            net_mass_kg=_D("1000"),
        )
        assert vr.warnings == []

    def test_actual_method_too_low_warns(self):
        # Less than 5 % of default → implausibly low
        vr = validate_against_defaults(
            "25232900", "actual",
            direct_kgco2e=_D("0.001"),  # <0.1 % of default
            net_mass_kg=_D("1000"),
        )
        assert len(vr.warnings) == 1
        assert "actual_implausibly_low" in vr.warnings[0]

    def test_actual_method_too_high_warns(self):
        # More than 10× default → implausibly high
        vr = validate_against_defaults(
            "25232900", "actual",
            direct_kgco2e=_D("0.810") * _D("11"),  # 11×
            net_mass_kg=_D("1000"),
        )
        assert len(vr.warnings) == 1
        assert "actual_implausibly_high" in vr.warnings[0]

    # ── method="estimated" ────────────────────────────────────────────────────

    def test_estimated_method_no_factor_warning(self):
        # method="estimated" skips factor checks
        vr = validate_against_defaults(
            "25232900", "estimated",
            direct_kgco2e=_D("100.0"),  # wildly high
            net_mass_kg=_D("1000"),
        )
        assert vr.warnings == []

    # ── ValidationResult fields ───────────────────────────────────────────────

    def test_result_deviation_pct_computed(self):
        # Submitted is 10 % above default (0.810 × 1.10 = 0.891)
        vr = validate_against_defaults(
            "25232900", "default",
            direct_kgco2e=_D("0.810") * _D("1.10"),
            net_mass_kg=_D("1000"),
        )
        assert vr.deviation_pct is not None
        assert abs(vr.deviation_pct - _D("10.0")) < _D("0.5")

    def test_result_default_see_is_returned(self):
        vr = validate_against_defaults(
            "25232900", "default",
            direct_kgco2e=_D("0.810"),
            net_mass_kg=_D("1000"),
        )
        assert isinstance(vr.default_see, DefaultSEE)
        assert vr.default_see.sector == "cement"

    def test_result_computed_kgco2e_set_for_1000kg(self):
        vr = validate_against_defaults(
            "25232900", "default",
            direct_kgco2e=_D("0.810"),
            net_mass_kg=_D("1000"),
        )
        assert vr.computed_direct_kgco2e == _D("0.810")

    def test_zero_mass_returns_no_computed(self):
        vr = validate_against_defaults(
            "25232900", "default",
            direct_kgco2e=_D("0.100"),
            net_mass_kg=_D("0"),
        )
        assert vr.computed_direct_kgco2e is None
        assert vr.deviation_pct is None
