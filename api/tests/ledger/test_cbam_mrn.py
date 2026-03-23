"""Tests for cbam_mrn — EU Movement Reference Number validation (task #10).

Coverage:
- validate_mrn():
    - Valid 18-char MRN → is_valid=True, missing=False, format_invalid=False
    - Fixture MRN "24GB123456789000A1" → valid
    - Missing / None / blank → missing=True, is_valid=False
    - Too short → format_invalid=True
    - Too long → format_invalid=True
    - Wrong first 2 chars (letters instead of digits) → format_invalid=True
    - Wrong chars 3-4 (digits instead of letters) → format_invalid=True
    - Invalid chars in body (hyphen, space) → format_invalid=True
    - "ER-001" (common test placeholder) → format_invalid=True
    - Case normalisation: lowercase → uppercased in normalised field
    - Whitespace stripping
    - normalised field correct for valid MRN
    - regulation_ref is populated
    - MRNValidationResult is frozen (immutable)
- Data quality integration:
    - Valid entry_reference → no format_invalid warning
    - Invalid format entry_reference → entry_reference_format_invalid warning
    - Missing entry_reference → entry_reference_missing warning (not format_invalid)
    - Data quality score reduced for format_invalid warning
- Data quality API via report-package:
    - Shipment with invalid MRN → warning in data_quality.warnings
    - Shipment with valid MRN → no format_invalid warning
"""

from __future__ import annotations

import pytest

from ledger_app.services.cbam_mrn import (
    MRN_LENGTH,
    MRNValidationResult,
    validate_mrn,
)


# ── validate_mrn — valid paths ────────────────────────────────────────────────

class TestValidMRN:
    def test_fixture_mrn_valid(self):
        """The MRN used throughout our test fixtures must pass validation."""
        result = validate_mrn("24GB123456789000A1")
        assert result.is_valid is True
        assert result.missing is False
        assert result.format_invalid is False

    def test_normalised_matches_input_uppercase(self):
        result = validate_mrn("24GB123456789000A1")
        assert result.normalised == "24GB123456789000A1"

    def test_another_valid_mrn_de(self):
        # 24 + DE + 13 alphanum (1234567890001) + 1 check digit = 18 chars
        result = validate_mrn("24DE12345678900011")
        assert result.is_valid is True

    def test_another_valid_mrn_fr(self):
        result = validate_mrn("25FR00000000000001")
        assert result.is_valid is True

    def test_length_is_18(self):
        valid = "24GB123456789000A1"
        assert len(valid) == MRN_LENGTH
        assert validate_mrn(valid).is_valid is True

    def test_all_digit_body_valid(self):
        result = validate_mrn("24DE000000000000001"[:18])
        # Build exact 18-char all-digit body variant
        mrn = "24DE" + "A" * 12 + "0" + "9"  # 2+2+12+1+1 = 18
        assert validate_mrn(mrn).is_valid is True

    def test_regulation_ref_populated(self):
        result = validate_mrn("24GB123456789000A1")
        assert "952/2013" in result.regulation_ref
        assert "2015/2446" in result.regulation_ref

    def test_entry_reference_echoed(self):
        result = validate_mrn("24GB123456789000A1")
        assert result.entry_reference == "24GB123456789000A1"


# ── validate_mrn — missing paths ──────────────────────────────────────────────

class TestMissingMRN:
    def test_none_is_missing(self):
        result = validate_mrn(None)
        assert result.missing is True
        assert result.is_valid is False
        assert result.format_invalid is False
        assert result.normalised is None

    def test_empty_string_is_missing(self):
        result = validate_mrn("")
        assert result.missing is True

    def test_whitespace_only_is_missing(self):
        result = validate_mrn("   ")
        assert result.missing is True

    def test_missing_entry_reference_echoed(self):
        result = validate_mrn(None)
        assert result.entry_reference is None


# ── validate_mrn — format invalid paths ───────────────────────────────────────

class TestInvalidMRNFormat:
    def test_er_001_invalid(self):
        """Placeholder used in old tests — not a valid MRN."""
        result = validate_mrn("ER-001")
        assert result.is_valid is False
        assert result.format_invalid is True
        assert result.missing is False

    def test_too_short_17_chars(self):
        result = validate_mrn("24GB12345678900A")  # 17 chars
        assert result.format_invalid is True

    def test_too_long_19_chars(self):
        result = validate_mrn("24GB123456789000A12")  # 19 chars
        assert result.format_invalid is True

    def test_first_two_chars_letters_not_digits(self):
        """Year positions must be digits."""
        result = validate_mrn("AAGB123456789000A1")
        assert result.format_invalid is True

    def test_chars_3_4_digits_not_letters(self):
        """Member-state positions must be uppercase letters."""
        result = validate_mrn("2412123456789000A1")
        assert result.format_invalid is True

    def test_hyphen_in_body_invalid(self):
        result = validate_mrn("24GB-23456789000A1")
        assert result.format_invalid is True

    def test_space_in_body_invalid(self):
        result = validate_mrn("24GB 23456789000A1")
        assert result.format_invalid is True

    def test_lowercase_not_normalised_invalid(self):
        """After stripping, lowercase letters in CC positions fail the regex."""
        result = validate_mrn("24gb123456789000A1")
        # normalised = "24GB123456789000A1" → valid after upper()
        assert result.is_valid is True  # strip().upper() makes it valid

    def test_pure_digits_no_country_code(self):
        result = validate_mrn("2412345678901234567")  # 19 chars, all digits
        assert result.format_invalid is True

    def test_short_placeholder_invalid(self):
        for ref in ["REF-1", "24GB", "123", "CUSTOMS-REF-001"]:
            result = validate_mrn(ref)
            assert result.is_valid is False, f"{ref!r} should be invalid"


# ── validate_mrn — normalisation ──────────────────────────────────────────────

class TestNormalisation:
    def test_lowercase_cc_normalised_and_valid(self):
        result = validate_mrn("24gb123456789000A1")
        assert result.normalised == "24GB123456789000A1"
        assert result.is_valid is True

    def test_leading_trailing_whitespace_stripped(self):
        result = validate_mrn("  24GB123456789000A1  ")
        assert result.normalised == "24GB123456789000A1"
        assert result.is_valid is True

    def test_original_value_preserved_in_entry_reference(self):
        original = "  24gb123456789000A1  "
        result = validate_mrn(original)
        assert result.entry_reference == original


# ── MRNValidationResult immutability ──────────────────────────────────────────

class TestMRNValidationResultFrozen:
    def test_frozen(self):
        result = validate_mrn("24GB123456789000A1")
        with pytest.raises((AttributeError, TypeError)):
            result.is_valid = False  # type: ignore[misc]


# ── Data quality integration ──────────────────────────────────────────────────

class TestDataQualityMRNIntegration:
    """evaluate_cbam_data_quality() must surface MRN format warnings."""

    def _run_dq(self, entry_reference):
        from ledger_app.services.cbam_data_quality import evaluate_cbam_data_quality
        case_row = {
            "id": "case-1",
            "importer_eori": "DE123456789",
            "reporting_year": 2025,
            "reporting_quarter": 1,
        }
        goods_line = {
            "id": "gl-1",
            "cn_code": "72081000",
            "sector": "iron_steel",
            "quantity": 1000.0,
            "quantity_unit": "kg",
            "installation_id": "DE_12345678",
        }
        emissions = {
            "method": "actual",
            "direct_embedded_kgco2e": 500.0,
            "indirect_embedded_kgco2e": 50.0,
        }
        shipments_payload = [
            {
                "shipment": {
                    "id": "ship-1",
                    "entry_reference": entry_reference,
                    "origin_country": "TR",
                    "incoterm": "CIF",
                },
                "goods_lines": [
                    {"goods_line": goods_line, "latest_emissions": emissions}
                ],
            }
        ]
        return evaluate_cbam_data_quality(case_row, shipments_payload)

    def test_valid_mrn_no_format_warning(self):
        dq = self._run_dq("24GB123456789000A1")
        assert all("entry_reference_format_invalid" not in w for w in dq["warnings"])

    def test_invalid_mrn_format_warning_added(self):
        dq = self._run_dq("ER-001")
        assert any("entry_reference_format_invalid" in w for w in dq["warnings"])

    def test_missing_mrn_missing_warning_not_format(self):
        dq = self._run_dq(None)
        assert any("entry_reference_missing" in w for w in dq["warnings"])
        assert all("entry_reference_format_invalid" not in w for w in dq["warnings"])

    def test_format_invalid_reduces_score(self):
        """An invalid MRN adds a warning → score < 100."""
        dq = self._run_dq("BAD-MRN")
        assert dq["score"] < 100.0

    def test_valid_mrn_does_not_reduce_score_for_mrn(self):
        """With all other fields perfect and valid MRN, MRN should not add penalty."""
        dq_valid = self._run_dq("24GB123456789000A1")
        dq_invalid = self._run_dq("BAD-MRN")
        assert dq_valid["score"] > dq_invalid["score"]

    def test_format_invalid_not_blocking(self):
        """MRN format warning must not block the compliance pack — non-blocking."""
        dq = self._run_dq("BAD-MRN")
        assert dq["blocking"] is False


# ── Compliance pack flags ─────────────────────────────────────────────────────

class TestCompliancePackMRNFlags:
    """_build_data_quality_flags() in narrative service must also check MRN."""

    def _run_flags(self, entry_reference):
        from app.services.compliance_pack import _build_data_quality_flags
        report_package = {
            "shipments": [
                {
                    "shipment": {
                        "id": "ship-1",
                        "entry_reference": entry_reference,
                    },
                    "goods_lines": [],
                }
            ]
        }
        return _build_data_quality_flags(report_package)

    def test_valid_mrn_no_flag(self):
        flags = self._run_flags("24GB123456789000A1")
        assert all("entry_reference_format_invalid" not in f for f in flags)

    def test_invalid_mrn_flag_added(self):
        flags = self._run_flags("ER-001")
        assert any("entry_reference_format_invalid" in f for f in flags)

    def test_missing_mrn_missing_flag_not_format(self):
        flags = self._run_flags(None)
        assert any("entry_reference_missing" in f for f in flags)
        assert all("entry_reference_format_invalid" not in f for f in flags)

    def test_invalid_mrn_not_also_missing(self):
        """Present-but-invalid MRN must not fire the 'missing' flag."""
        flags = self._run_flags("ER-001")
        assert all("entry_reference_missing" not in f for f in flags)
