"""Tests for cbam_classifier — CN code classification from product descriptions."""
from __future__ import annotations

from decimal import Decimal

import pytest

from ledger_app.services.cbam_classifier import (
    AUTO_ASSIGN_THRESHOLD,
    LLM_TRIGGER_THRESHOLD,
    REVIEW_THRESHOLD,
    CNClassificationResult,
    classify_description,
)


class TestCementClassification:
    def test_grey_portland_cement(self):
        r = classify_description("ordinary portland cement OPC bulk shipment", llm_fallback=False)
        assert r.cn_code == "25232900"
        assert r.sector == "cement"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD
        assert r.requires_review is False

    def test_cement_clinker(self):
        r = classify_description("portland cement clinker 50mt", llm_fallback=False)
        assert r.cn_code == "25231000"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_white_portland(self):
        r = classify_description("white portland cement WPC bagged", llm_fallback=False)
        assert r.cn_code == "25232100"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD


class TestIronSteelClassification:
    def test_hot_rolled_coil(self):
        r = classify_description("hot rolled coil HRC S275 2.5mm thickness", llm_fallback=False)
        assert r.cn_code == "7208"
        assert r.sector == "iron_steel"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD
        assert r.requires_review is False

    def test_hrc_abbreviation(self):
        r = classify_description("HRC steel 3mm ASTM A36", llm_fallback=False)
        assert r.cn_code == "7208"
        assert r.confidence >= LLM_TRIGGER_THRESHOLD

    def test_cold_rolled_coil(self):
        r = classify_description("cold rolled coil CRC 1.2mm DC01", llm_fallback=False)
        assert r.cn_code == "7209"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_galvanized_steel(self):
        r = classify_description("hot dip galvanized coil HDG GI steel zinc coated", llm_fallback=False)
        assert r.cn_code == "7210"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_rebar(self):
        r = classify_description("reinforcing bar deformed TMT rebar B500B", llm_fallback=False)
        assert r.cn_code == "7214"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_structural_beam(self):
        r = classify_description("wide flange H beam HEA200 structural steel section", llm_fallback=False)
        assert r.cn_code == "7216"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_stainless_sheet(self):
        r = classify_description("stainless steel sheet 304 2B finish cold rolled", llm_fallback=False)
        assert r.cn_code == "7219"
        assert r.sector == "iron_steel"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_steel_billet(self):
        r = classify_description("continuously cast steel billet 150x150 S235", llm_fallback=False)
        assert r.cn_code == "7207"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_seamless_pipe(self):
        r = classify_description("seamless steel pipe SMLS API 5L X65", llm_fallback=False)
        assert r.cn_code == "7304"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_steel_structure(self):
        r = classify_description("prefabricated steel structure building frame", llm_fallback=False)
        assert r.cn_code == "7308"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD


class TestAluminiumClassification:
    def test_aluminium_ingot(self):
        r = classify_description("primary aluminium ingot P1020 LME grade", llm_fallback=False)
        assert r.cn_code == "7601"
        assert r.sector == "aluminium"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_aluminium_sheet(self):
        r = classify_description("aluminium sheet 3003 H14 1.5mm", llm_fallback=False)
        assert r.cn_code == "7606"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_aluminium_profile(self):
        r = classify_description("extruded aluminium profile 6063 T5 architectural section", llm_fallback=False)
        assert r.cn_code == "7604"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_aluminium_foil(self):
        r = classify_description("aluminium foil household grade 10 micron", llm_fallback=False)
        assert r.cn_code == "7607"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD


class TestFertiliserClassification:
    def test_urea(self):
        r = classify_description("prilled urea 46% nitrogen granular fertilizer", llm_fallback=False)
        assert r.cn_code == "31021000"
        assert r.sector == "fertilisers"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_ammonium_nitrate(self):
        r = classify_description("ammonium nitrate AN 34.5N technical grade", llm_fallback=False)
        assert r.cn_code == "31023090"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_dap(self):
        r = classify_description("diammonium phosphate DAP 18-46-0 granular", llm_fallback=False)
        assert r.cn_code == "31053000"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_npk(self):
        r = classify_description("NPK fertilizer 15-15-15 compound fertilizer", llm_fallback=False)
        assert r.cn_code == "31052010"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_anhydrous_ammonia(self):
        r = classify_description("anhydrous ammonia liquid NH3 refrigerant grade", llm_fallback=False)
        assert r.cn_code == "28141000"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD


class TestHydrogenClassification:
    def test_hydrogen(self):
        r = classify_description("compressed hydrogen gas H2 industrial grade", llm_fallback=False)
        assert r.cn_code == "28041000"
        assert r.sector == "hydrogen"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD

    def test_green_hydrogen(self):
        r = classify_description("green hydrogen electrolyser output renewable", llm_fallback=False)
        assert r.cn_code == "28041000"
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD


class TestElectricityClassification:
    def test_electricity(self):
        r = classify_description("electrical energy supply MWh", llm_fallback=False)
        assert r.cn_code == "27160000"
        assert r.sector == "electricity"


class TestConfidenceAndReview:
    def test_high_confidence_no_review(self):
        r = classify_description("hot rolled coil HRC S275", llm_fallback=False)
        assert r.confidence >= AUTO_ASSIGN_THRESHOLD
        assert r.requires_review is False

    def test_low_confidence_triggers_review(self):
        r = classify_description("metal product industrial grade", llm_fallback=False)
        assert r.requires_review is True

    def test_out_of_scope_product(self):
        r = classify_description("polyethylene plastic pellets HDPE resin", llm_fallback=False)
        assert r.requires_review is True
        assert r.confidence < AUTO_ASSIGN_THRESHOLD

    def test_candidates_returned(self):
        r = classify_description("hot rolled coil HRC steel", llm_fallback=False)
        assert isinstance(r.candidates, list)
        assert len(r.candidates) >= 1
        assert "cn_code" in r.candidates[0]
        assert "confidence" in r.candidates[0]


class TestHintCnCode:
    def test_valid_hint_used(self):
        r = classify_description("some steel product", hint_cn_code="7208")
        assert r.cn_code.startswith("7208") or r.cn_code == "7208"
        assert r.method == "hint"
        assert r.confidence == Decimal("0.95")

    def test_invalid_hint_ignored(self):
        # Plastics CN code not in CBAM scope — hint should be ignored and
        # the classifier should fall through to keyword/no-match result.
        r = classify_description("hot rolled coil steel", hint_cn_code="39011000", llm_fallback=False)
        assert r.method != "hint"


class TestCnCodeInDescription:
    def test_valid_cbam_cn_code_in_description(self):
        r = classify_description("goods CN code 72081000 hot rolled steel", llm_fallback=False)
        # Either the exact 8-digit code or the 4-digit heading prefix is acceptable.
        assert r.cn_code == "72081000" or r.cn_code.startswith("7208")
        assert r.method == "extracted_from_text" or r.confidence >= Decimal("0.90")


class TestResultStructure:
    def test_result_is_dataclass(self):
        r = classify_description("urea fertilizer", llm_fallback=False)
        assert isinstance(r, CNClassificationResult)
        assert isinstance(r.cn_code, str)
        assert isinstance(r.confidence, Decimal)
        assert isinstance(r.requires_review, bool)
        assert isinstance(r.candidates, list)

    def test_method_is_keyword_without_llm(self):
        r = classify_description("hot rolled coil HRC", llm_fallback=False)
        assert r.method in ("keyword", "extracted_from_text", "hint")
