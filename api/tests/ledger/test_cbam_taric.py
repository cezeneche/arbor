"""Tests for cbam_taric — EU Regulation 2023/956 Annex I CN code lookup.

Coverage:
- All six CBAM sectors with representative CN codes from each
- Exact 8-digit codes (most specific)
- 6-digit and 4-digit codes (heading-level match)
- Partial headings (2507, 2804, 2808, 2814, 3102, 3105)
- Out-of-scope codes (heading 7313 excluded from Ch. 73, non-CBAM chapters)
- Input format tolerance (spaces, dots, dashes)
- CBAMCodeNotInScope exception message and attributes
- is_in_cbam_scope helper
"""

from __future__ import annotations

import pytest

from ledger_app.services.cbam_taric import (
    SECTOR_ALUMINIUM,
    SECTOR_CEMENT,
    SECTOR_ELECTRICITY,
    SECTOR_FERTILISERS,
    SECTOR_HYDROGEN,
    SECTOR_IRON_STEEL,
    CBAMCodeNotInScope,
    is_in_cbam_scope,
    lookup_sector,
)


# ── Cement ────────────────────────────────────────────────────────────────────

class TestCement:
    def test_portland_cement_8digit(self):
        assert lookup_sector("25232900") == SECTOR_CEMENT

    def test_cement_clinker_8digit(self):
        assert lookup_sector("25231000") == SECTOR_CEMENT

    def test_aluminous_cement_8digit(self):
        assert lookup_sector("25233000") == SECTOR_CEMENT

    def test_heading_2523_4digit(self):
        assert lookup_sector("2523") == SECTOR_CEMENT

    def test_calcined_kaolin_in_scope(self):
        # 2507 00 80 — only this specific subheading is in CBAM Annex I
        assert lookup_sector("25070080") == SECTOR_CEMENT

    def test_uncalcined_kaolin_not_in_scope(self):
        # 2507 00 20 — not in CBAM Annex I
        assert lookup_sector("25070020") is None

    def test_heading_2507_4digit_not_in_scope(self):
        # 4-digit heading alone is insufficient — only a specific subheading applies
        assert lookup_sector("2507") is None


# ── Iron & Steel ──────────────────────────────────────────────────────────────

class TestIronSteel:
    def test_chapter_72_heading(self):
        for heading in ["7201", "7208", "7213", "7218", "7225", "7229"]:
            assert lookup_sector(heading) == SECTOR_IRON_STEEL, heading

    def test_hot_rolled_coil_8digit(self):
        assert lookup_sector("72081000") == SECTOR_IRON_STEEL

    def test_stainless_flat_rolled(self):
        assert lookup_sector("72193100") == SECTOR_IRON_STEEL

    def test_chapter_73_in_scope_headings(self):
        for heading in ["7301", "7304", "7307", "7308", "7318", "7326"]:
            assert lookup_sector(heading) == SECTOR_IRON_STEEL, heading

    def test_7313_barbed_wire_not_in_scope(self):
        # Heading 7313 (barbed wire) is explicitly excluded from CBAM Annex I
        assert lookup_sector("7313") is None
        assert lookup_sector("73130000") is None

    def test_tube_fittings_6digit(self):
        assert lookup_sector("730711") == SECTOR_IRON_STEEL

    def test_screws_bolts_8digit(self):
        assert lookup_sector("73181500") == SECTOR_IRON_STEEL


# ── Aluminium ─────────────────────────────────────────────────────────────────

class TestAluminium:
    def test_unwrought_aluminium_heading(self):
        assert lookup_sector("7601") == SECTOR_ALUMINIUM

    def test_aluminium_wire_8digit(self):
        assert lookup_sector("76051100") == SECTOR_ALUMINIUM

    def test_aluminium_sheet_8digit(self):
        assert lookup_sector("76061100") == SECTOR_ALUMINIUM

    def test_aluminium_foil_8digit(self):
        assert lookup_sector("76071100") == SECTOR_ALUMINIUM

    def test_all_aluminium_headings(self):
        for heading in [f"76{str(i).zfill(2)}" for i in range(1, 17)]:
            assert lookup_sector(heading) == SECTOR_ALUMINIUM, heading


# ── Fertilisers ───────────────────────────────────────────────────────────────

class TestFertilisers:
    def test_anhydrous_ammonia(self):
        assert lookup_sector("28141000") == SECTOR_FERTILISERS

    def test_ammonia_aqueous(self):
        assert lookup_sector("28142000") == SECTOR_FERTILISERS

    def test_nitric_acid(self):
        assert lookup_sector("28080000") == SECTOR_FERTILISERS

    def test_magnesium_sulphate(self):
        assert lookup_sector("28332100") == SECTOR_FERTILISERS

    def test_potassium_nitrate(self):
        assert lookup_sector("28342100") == SECTOR_FERTILISERS

    def test_urea(self):
        assert lookup_sector("31021000") == SECTOR_FERTILISERS

    def test_ammonium_nitrate(self):
        assert lookup_sector("31023090") == SECTOR_FERTILISERS

    def test_ammonium_sulphate(self):
        assert lookup_sector("31022100") == SECTOR_FERTILISERS

    def test_diammonium_phosphate(self):
        assert lookup_sector("31053000") == SECTOR_FERTILISERS

    def test_npk_fertiliser(self):
        assert lookup_sector("31052010") == SECTOR_FERTILISERS

    def test_chapter_28_partial_heading_2808_4digit_not_in_scope(self):
        # Heading 2808 — only 2808 00 00 is in scope; heading-level is ambiguous
        # 4-digit alone should NOT match since not all of 2808 is in scope
        assert lookup_sector("2808") is None

    def test_chapter_28_non_cbam_subheading(self):
        # 2833 11 00 — sulphates of disodium, not in CBAM
        assert lookup_sector("28331100") is None


# ── Electricity ───────────────────────────────────────────────────────────────

class TestElectricity:
    def test_electrical_energy_8digit(self):
        assert lookup_sector("27160000") == SECTOR_ELECTRICITY

    def test_electrical_energy_6digit(self):
        assert lookup_sector("271600") == SECTOR_ELECTRICITY

    def test_heading_2716_4digit_not_matched_at_heading_level(self):
        # 2716 is a single-CN8 heading; 4-digit alone does NOT match the
        # heading map (it is only in _CN8_TO_SECTOR)
        assert lookup_sector("2716") is None


# ── Hydrogen ──────────────────────────────────────────────────────────────────

class TestHydrogen:
    def test_hydrogen_8digit(self):
        assert lookup_sector("28041000") == SECTOR_HYDROGEN

    def test_hydrogen_6digit(self):
        assert lookup_sector("280410") == SECTOR_HYDROGEN

    def test_other_2804_subheading_not_in_scope(self):
        # 2804 20 00 — nitrogen, not hydrogen
        assert lookup_sector("28042000") is None

    def test_heading_2804_4digit_not_in_scope(self):
        assert lookup_sector("2804") is None


# ── Out-of-scope codes ────────────────────────────────────────────────────────

class TestOutOfScope:
    def test_plastics_not_in_scope(self):
        assert lookup_sector("39011000") is None

    def test_automotive_not_in_scope(self):
        assert lookup_sector("87032319") is None

    def test_textiles_not_in_scope(self):
        assert lookup_sector("52010000") is None

    def test_empty_string(self):
        assert lookup_sector("") is None

    def test_non_digit_only(self):
        assert lookup_sector("---") is None

    def test_7313_barbed_wire_fully_excluded(self):
        assert lookup_sector("73130010") is None
        assert lookup_sector("73130090") is None


# ── Input format tolerance ────────────────────────────────────────────────────

class TestInputFormats:
    def test_spaces_stripped(self):
        assert lookup_sector("2523 29 00") == SECTOR_CEMENT

    def test_dots_stripped(self):
        assert lookup_sector("2523.29.00") == SECTOR_CEMENT

    def test_dashes_stripped(self):
        assert lookup_sector("2523-29-00") == SECTOR_CEMENT

    def test_mixed_format(self):
        assert lookup_sector("7208 10 00") == SECTOR_IRON_STEEL

    def test_10digit_truncates_to_8(self):
        # Some EU customs systems use 10-digit commodity codes (CN8 + statistical)
        assert lookup_sector("7208100090") == SECTOR_IRON_STEEL


# ── CBAMCodeNotInScope exception ──────────────────────────────────────────────

class TestCBAMCodeNotInScope:
    def test_exception_carries_cn_code(self):
        exc = CBAMCodeNotInScope("99999999")
        assert exc.cn_code == "99999999"

    def test_exception_message_contains_regulation(self):
        exc = CBAMCodeNotInScope("12345678")
        assert "2023/956" in str(exc)
        assert "Annex I" in str(exc)

    def test_is_value_error(self):
        with pytest.raises(ValueError):
            raise CBAMCodeNotInScope("00000000")


# ── is_in_cbam_scope helper ───────────────────────────────────────────────────

class TestIsInCBAMScope:
    def test_cement_in_scope(self):
        assert is_in_cbam_scope("25232900") is True

    def test_steel_in_scope(self):
        assert is_in_cbam_scope("72081000") is True

    def test_random_code_not_in_scope(self):
        assert is_in_cbam_scope("99001234") is False

    def test_7313_not_in_scope(self):
        assert is_in_cbam_scope("73130000") is False
