"""Tests for the risk-weighted data quality scorer (task #11).

Coverage:
- _compute_score(): weighted penalties for missing and warning issues
- _risk_tier(): correct tier assignment at each boundary
- _check_sector(): sector vs CN code mismatch detection
- evaluate_cbam_data_quality() integration:
    - risk_tier field present in output
    - score reflects issue-specific weights (not flat 40/10)
    - blocking issues carry heavier penalty than warnings
    - sector_mismatch warning is raised for wrong sector
    - sector is accepted when it matches TARIC lookup
    - valid sector with unknown CN code does not warn
    - method_not_actual weight is higher than incoterm_missing weight
    - EORI missing gives heavier penalty than a single warning
    - risk_tier=blocking when missing is non-empty
    - risk_tier=low when no issues
    - risk_tier=medium / high at correct score boundaries
    - legacy tests: invoice_number_missing not triggered when only
      entry_reference is present
"""

from __future__ import annotations

import pytest

from ledger_app.services.cbam_data_quality import (
    _compute_score,
    _issue_weight,
    _MISSING_WEIGHT_MAP,
    _WARNING_WEIGHT_MAP,
    _DEFAULT_MISSING_WEIGHT,
    _DEFAULT_WARNING_WEIGHT,
    _risk_tier,
    evaluate_cbam_data_quality,
)


# ── _issue_weight ─────────────────────────────────────────────────────────────

class TestIssueWeight:
    def test_exact_missing_match(self):
        assert _issue_weight("case:importer_eori_missing", _MISSING_WEIGHT_MAP, _DEFAULT_MISSING_WEIGHT) == 50

    def test_substring_missing_match(self):
        assert _issue_weight("shipment:S1:origin_country_missing", _MISSING_WEIGHT_MAP, _DEFAULT_MISSING_WEIGHT) == 30

    def test_missing_default_weight(self):
        assert _issue_weight("goods_line:G1:some_unknown_issue", _MISSING_WEIGHT_MAP, _DEFAULT_MISSING_WEIGHT) == 20

    def test_warning_entry_reference_format_invalid(self):
        assert _issue_weight("shipment:S1:entry_reference_format_invalid", _WARNING_WEIGHT_MAP, _DEFAULT_WARNING_WEIGHT) == 15

    def test_warning_method_not_actual(self):
        assert _issue_weight("goods_line:G1:method_not_actual", _WARNING_WEIGHT_MAP, _DEFAULT_WARNING_WEIGHT) == 15

    def test_warning_sector_mismatch(self):
        assert _issue_weight("goods_line:G1:sector_mismatch:declared='iron_steel' expected='cement'", _WARNING_WEIGHT_MAP, _DEFAULT_WARNING_WEIGHT) == 12

    def test_warning_installation_id_missing(self):
        assert _issue_weight("goods_line:G1:installation_id_missing", _WARNING_WEIGHT_MAP, _DEFAULT_WARNING_WEIGHT) == 10

    def test_warning_entry_reference_missing(self):
        assert _issue_weight("shipment:S1:entry_reference_missing", _WARNING_WEIGHT_MAP, _DEFAULT_WARNING_WEIGHT) == 8

    def test_warning_incoterm_missing(self):
        assert _issue_weight("shipment:S1:incoterm_missing", _WARNING_WEIGHT_MAP, _DEFAULT_WARNING_WEIGHT) == 5

    def test_warning_invoice_number_missing(self):
        assert _issue_weight("shipment:S1:invoice_number_missing", _WARNING_WEIGHT_MAP, _DEFAULT_WARNING_WEIGHT) == 5

    def test_warning_default_weight_for_unknown(self):
        assert _issue_weight("shipment:S1:some_future_check", _WARNING_WEIGHT_MAP, _DEFAULT_WARNING_WEIGHT) == 5

    def test_cbam_factors_default_deviation(self):
        assert _issue_weight("cbam_factors:default_deviation:72081000:...", _WARNING_WEIGHT_MAP, _DEFAULT_WARNING_WEIGHT) == 10

    def test_cbam_factors_actual_implausibly_low(self):
        assert _issue_weight("cbam_factors:actual_implausibly_low:72081000:...", _WARNING_WEIGHT_MAP, _DEFAULT_WARNING_WEIGHT) == 12

    def test_cbam_factors_actual_implausibly_high(self):
        assert _issue_weight("cbam_factors:actual_implausibly_high:72081000:...", _WARNING_WEIGHT_MAP, _DEFAULT_WARNING_WEIGHT) == 12

    def test_installation_id_required_for_actual_method(self):
        issue = "goods_line:G1:installation_id_required_for_actual_method — EU 2023/956 Art. 10 ..."
        assert _issue_weight(issue, _WARNING_WEIGHT_MAP, _DEFAULT_WARNING_WEIGHT) == 12


# ── _compute_score ────────────────────────────────────────────────────────────

class TestComputeScore:
    def test_no_issues_is_100(self):
        assert _compute_score([], []) == 100.0

    def test_single_missing_importer_eori(self):
        # Weight = 50 → score = 50
        assert _compute_score(["case:importer_eori_missing"], []) == 50.0

    def test_single_warning_method_not_actual(self):
        # Weight = 15 → score = 85
        assert _compute_score([], ["goods_line:G1:method_not_actual"]) == 85.0

    def test_score_floors_at_zero(self):
        missing = [
            "case:importer_eori_missing",  # 50
            "shipment:S1:origin_country_missing",  # 30
            "goods_line:G1:cn_code_missing",  # 30
        ]
        # penalty = 110 → max(0, 100-110) = 0
        assert _compute_score(missing, []) == 0.0

    def test_mixed_missing_and_warning(self):
        missing = ["goods_line:G1:missing_emissions"]  # 25
        warnings = ["shipment:S1:incoterm_missing"]  # 5
        # penalty = 30 → score = 70
        assert _compute_score(missing, warnings) == 70.0

    def test_not_flat_penalty(self):
        """Weighted score must differ from legacy flat model for same issue counts."""
        # Flat model: 1 missing = 40 penalty → score 60
        # Weighted: importer_eori_missing = 50 penalty → score 50
        score_weighted = _compute_score(["case:importer_eori_missing"], [])
        assert score_weighted != 60.0  # must differ from flat model

    def test_heavier_missing_than_warning(self):
        """A single critical missing issue penalises more than multiple low warnings."""
        score_with_missing = _compute_score(["case:importer_eori_missing"], [])
        score_with_warnings = _compute_score([], ["shipment:S1:incoterm_missing"] * 5)
        assert score_with_missing < score_with_warnings


# ── _risk_tier ────────────────────────────────────────────────────────────────

class TestRiskTier:
    def test_blocking_when_missing(self):
        assert _risk_tier(50.0, True) == "blocking"

    def test_blocking_overrides_high_score(self):
        # Even a high score is still blocking when missing is non-empty
        assert _risk_tier(90.0, True) == "blocking"

    def test_high_when_score_below_60(self):
        assert _risk_tier(59.9, False) == "high"
        assert _risk_tier(0.0, False) == "high"

    def test_medium_when_score_60_to_79(self):
        assert _risk_tier(60.0, False) == "medium"
        assert _risk_tier(79.9, False) == "medium"

    def test_low_when_score_80_or_above(self):
        assert _risk_tier(80.0, False) == "low"
        assert _risk_tier(100.0, False) == "low"

    def test_boundary_60_is_medium_not_high(self):
        assert _risk_tier(60.0, False) == "medium"

    def test_boundary_80_is_low_not_medium(self):
        assert _risk_tier(80.0, False) == "low"


# ── Sector validation integration ─────────────────────────────────────────────

def _run_dq(*, cn_code, sector, method="actual", installation_id="DE_12345678"):
    """Helper: run evaluate_cbam_data_quality with a single goods line."""
    return evaluate_cbam_data_quality(
        {
            "importer_eori": "DE123456789",
            "reporting_year": 2025,
            "reporting_quarter": 1,
        },
        [
            {
                "shipment": {
                    "id": "S1",
                    "origin_country": "TR",
                    "entry_reference": "24GB123456789000A1",
                    "incoterm": "CIF",
                },
                "goods_lines": [
                    {
                        "goods_line": {
                            "id": "GL1",
                            "cn_code": cn_code,
                            "sector": sector,
                            "quantity": 1000.0,
                            "installation_id": installation_id,
                        },
                        "latest_emissions": {
                            "method": method,
                            "direct_embedded_kgco2e": 500.0,
                            "indirect_embedded_kgco2e": 50.0,
                        },
                    }
                ],
            }
        ],
    )


class TestSectorValidation:
    def test_correct_sector_no_warning(self):
        # CN 72081000 → iron_steel
        dq = _run_dq(cn_code="72081000", sector="iron_steel")
        assert all("sector_mismatch" not in w for w in dq["warnings"])

    def test_wrong_sector_raises_warning(self):
        # CN 72081000 is iron_steel; declaring it as cement is a mismatch
        dq = _run_dq(cn_code="72081000", sector="cement")
        assert any("sector_mismatch" in w for w in dq["warnings"])

    def test_sector_mismatch_warning_contains_cn_code(self):
        dq = _run_dq(cn_code="72081000", sector="cement")
        mismatch_warnings = [w for w in dq["warnings"] if "sector_mismatch" in w]
        assert len(mismatch_warnings) == 1
        assert "72081000" in mismatch_warnings[0]

    def test_sector_mismatch_contains_expected_and_declared(self):
        dq = _run_dq(cn_code="72081000", sector="cement")
        mismatch = next(w for w in dq["warnings"] if "sector_mismatch" in w)
        assert "iron_steel" in mismatch  # expected
        assert "cement" in mismatch      # declared

    def test_unknown_cn_code_no_sector_warning(self):
        # CN code not in CBAM scope → no sector_mismatch (flagged elsewhere)
        dq = _run_dq(cn_code="99999999", sector="iron_steel")
        assert all("sector_mismatch" not in w for w in dq["warnings"])

    def test_no_sector_field_no_sector_warning(self):
        dq = evaluate_cbam_data_quality(
            {
                "importer_eori": "DE123456789",
                "reporting_year": 2025,
                "reporting_quarter": 1,
            },
            [
                {
                    "shipment": {
                        "id": "S1",
                        "origin_country": "TR",
                        "entry_reference": "24GB123456789000A1",
                        "incoterm": "CIF",
                    },
                    "goods_lines": [
                        {
                            "goods_line": {
                                "id": "GL1",
                                "cn_code": "72081000",
                                # No sector field
                                "quantity": 1000.0,
                                "installation_id": "DE_12345678",
                            },
                            "latest_emissions": {
                                "method": "actual",
                                "direct_embedded_kgco2e": 500.0,
                            },
                        }
                    ],
                }
            ],
        )
        assert all("sector_mismatch" not in w for w in dq["warnings"])

    def test_aluminium_sector_correct(self):
        # Pick an aluminium CN code from TARIC table
        dq = _run_dq(cn_code="76011000", sector="aluminium")
        assert all("sector_mismatch" not in w for w in dq["warnings"])


# ── evaluate_cbam_data_quality — output shape ─────────────────────────────────

class TestEvaluateDQOutputShape:
    def _minimal_ok(self):
        return evaluate_cbam_data_quality(
            {
                "importer_eori": "DE123456789",
                "reporting_year": 2025,
                "reporting_quarter": 1,
            },
            [
                {
                    "shipment": {
                        "id": "S1",
                        "origin_country": "TR",
                        "entry_reference": "24GB123456789000A1",
                        "incoterm": "CIF",
                    },
                    "goods_lines": [
                        {
                            "goods_line": {
                                "id": "GL1",
                                "cn_code": "72081000",
                                "sector": "iron_steel",
                                "quantity": 1000.0,
                                "installation_id": "DE_12345678",
                            },
                            "latest_emissions": {
                                "method": "actual",
                                "direct_embedded_kgco2e": 500.0,
                                "indirect_embedded_kgco2e": 50.0,
                            },
                        }
                    ],
                }
            ],
        )

    def test_risk_tier_key_present(self):
        dq = self._minimal_ok()
        assert "risk_tier" in dq

    def test_risk_tier_low_when_all_ok(self):
        dq = self._minimal_ok()
        assert dq["risk_tier"] == "low"

    def test_score_key_still_present(self):
        dq = self._minimal_ok()
        assert "score" in dq

    def test_blocking_key_still_present(self):
        dq = self._minimal_ok()
        assert "blocking" in dq

    def test_missing_and_warnings_keys_still_present(self):
        dq = self._minimal_ok()
        assert "missing" in dq
        assert "warnings" in dq

    def test_risk_tier_blocking_when_missing_non_empty(self):
        dq = evaluate_cbam_data_quality(
            {"reporting_year": 2025, "reporting_quarter": 1},  # no importer_eori
            [],
        )
        assert dq["blocking"] is True
        assert dq["risk_tier"] == "blocking"

    def test_risk_tier_high_when_score_below_60(self):
        # 3 heavy missing issues → score = 0, but no blocking flag if... wait, missing IS blocking.
        # Use warnings-only scenario that drops score below 60.
        # method_not_actual (15) * 4 = 60 penalty → score 40
        warnings_heavy = evaluate_cbam_data_quality(
            {
                "importer_eori": "DE123456789",
                "reporting_year": 2025,
                "reporting_quarter": 1,
            },
            [
                {
                    "shipment": {
                        "id": f"S{i}",
                        "origin_country": "TR",
                        "entry_reference": "24GB123456789000A1",
                        "incoterm": "CIF",
                    },
                    "goods_lines": [
                        {
                            "goods_line": {
                                "id": f"GL{i}",
                                "cn_code": "72081000",
                                "quantity": 1000.0,
                                "installation_id": "DE_12345678",
                            },
                            "latest_emissions": {
                                "method": "default",  # triggers method_not_actual
                                "direct_embedded_kgco2e": 500.0,
                            },
                        }
                    ],
                }
                for i in range(4)
            ],
        )
        assert warnings_heavy["score"] < 60
        assert warnings_heavy["risk_tier"] == "high"

    def test_weighted_score_differs_from_flat_for_eori_missing(self):
        """EORI missing: weighted=50 penalty → score 50; flat would be 40 → score 60."""
        dq = evaluate_cbam_data_quality(
            {"reporting_year": 2025, "reporting_quarter": 1},  # no eori
            [],
        )
        # Flat model would give score=60; weighted gives score=50
        assert dq["score"] == 50.0

    def test_method_not_actual_weight_higher_than_incoterm(self):
        dq_method = evaluate_cbam_data_quality(
            {
                "importer_eori": "DE123456789",
                "reporting_year": 2025,
                "reporting_quarter": 1,
            },
            [
                {
                    "shipment": {
                        "id": "S1",
                        "origin_country": "TR",
                        "entry_reference": "24GB123456789000A1",
                        "incoterm": "CIF",
                    },
                    "goods_lines": [
                        {
                            "goods_line": {
                                "id": "GL1",
                                "cn_code": "72081000",
                                "quantity": 1000.0,
                                "installation_id": "DE_12345678",
                            },
                            "latest_emissions": {"method": "default"},
                        }
                    ],
                }
            ],
        )
        dq_incoterm = evaluate_cbam_data_quality(
            {
                "importer_eori": "DE123456789",
                "reporting_year": 2025,
                "reporting_quarter": 1,
            },
            [
                {
                    "shipment": {
                        "id": "S1",
                        "origin_country": "TR",
                        "entry_reference": "24GB123456789000A1",
                        # no incoterm
                    },
                    "goods_lines": [
                        {
                            "goods_line": {
                                "id": "GL1",
                                "cn_code": "72081000",
                                "quantity": 1000.0,
                                "installation_id": "DE_12345678",
                            },
                            "latest_emissions": {"method": "actual"},
                        }
                    ],
                }
            ],
        )
        # method_not_actual (15) > incoterm_missing (5) → lower score
        assert dq_method["score"] < dq_incoterm["score"]


# ── Backward-compatibility: existing test scenario ────────────────────────────

class TestBackwardCompatibility:
    def test_invoice_number_missing_not_triggered_when_only_entry_reference_present(self):
        result = evaluate_cbam_data_quality(
            {
                "id": "case-1",
                "importer_eori": "GB123456789",
                "reporting_year": 2025,
                "reporting_quarter": 1,
            },
            [
                {
                    "shipment": {
                        "id": "shipment-1",
                        "origin_country": "TR",
                        "invoice_number": None,
                        "entry_reference": "ER-ONLY-001",
                        "incoterm": "FOB",
                    },
                    "goods_lines": [
                        {
                            "goods_line": {
                                "id": "line-1",
                                "cn_code": "720711",
                                "quantity": 1000,
                                "net_mass_kg": 1000,
                                "installation_id": "INST-1",
                            },
                            "latest_emissions": {"method": "actual"},
                        }
                    ],
                }
            ],
        )
        assert "shipment:shipment-1:invoice_number_missing" not in result["warnings"]

    def test_blocking_is_false_with_no_missing(self):
        result = evaluate_cbam_data_quality(
            {
                "importer_eori": "DE123456789",
                "reporting_year": 2025,
                "reporting_quarter": 1,
            },
            [],
        )
        assert result["blocking"] is False

    def test_blocking_is_true_with_missing(self):
        result = evaluate_cbam_data_quality(
            {"reporting_year": 2025, "reporting_quarter": 1},
            [],
        )
        assert result["blocking"] is True
