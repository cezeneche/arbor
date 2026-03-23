"""Tests for cbam_installation_registry — EU 2023/956 Art. 10 validation.

Coverage:
- Non-actual methods: no checks applied
- method="actual", installation_id absent → blocking missing issue
- method="actual", installation_id empty string → blocking missing issue
- method="actual", valid EU EUTL format → passes cleanly
- method="actual", non-conforming format → warning (not blocking)
- Allowlist: ID in allowlist → passes
- Allowlist: ID not in allowlist → warning
- Allowlist empty → no allowlist warning even for non-conforming IDs
- Multiple warnings accumulated correctly
- InstallationValidationResult.is_valid reflects missing presence
- regulation reference appears in warning messages
"""

from __future__ import annotations

import pytest

from ledger_app.services.cbam_installation_registry import (
    INSTALLATION_ID_RE,
    InstallationValidationResult,
    validate_installation_id,
)


# ── INSTALLATION_ID_RE ────────────────────────────────────────────────────────

class TestInstallationIDRegex:
    def test_valid_de_format(self):
        assert INSTALLATION_ID_RE.match("DE_12345678")

    def test_valid_gb_format(self):
        assert INSTALLATION_ID_RE.match("GB_TL_123456")

    def test_valid_fr_with_dash(self):
        assert INSTALLATION_ID_RE.match("FR-OP-001")

    def test_valid_in_format(self):
        assert INSTALLATION_ID_RE.match("IN_CPCB_A001")

    def test_too_short(self):
        assert not INSTALLATION_ID_RE.match("DE1")  # only 3 chars after country = ok actually
        # DE + 1 char = 3 total, need ≥ 4 (2 letters + 2+ more)
        assert not INSTALLATION_ID_RE.match("DE_")  # underscore only after = no digit

    def test_starts_with_digit(self):
        assert not INSTALLATION_ID_RE.match("12345678")

    def test_single_letter_prefix(self):
        assert not INSTALLATION_ID_RE.match("D_123456")

    def test_lowercase_prefix(self):
        assert not INSTALLATION_ID_RE.match("de_12345")

    def test_spaces_rejected(self):
        assert not INSTALLATION_ID_RE.match("DE 12345")


# ── validate_installation_id ──────────────────────────────────────────────────

class TestValidateInstallationID:

    # Non-actual methods
    def test_default_method_no_checks(self):
        result = validate_installation_id(None, method="default")
        assert result.is_valid is True
        assert result.missing == []
        assert result.warnings == []

    def test_estimated_method_no_checks(self):
        result = validate_installation_id("", method="estimated")
        assert result.is_valid is True
        assert not result.missing

    # Presence check
    def test_actual_method_none_id_is_blocking(self):
        result = validate_installation_id(None, method="actual", goods_line_id="gl-1")
        assert result.is_valid is False
        assert len(result.missing) == 1
        assert "installation_id_required_for_actual_method" in result.missing[0]
        assert "EU 2023/956" in result.missing[0]

    def test_actual_method_empty_string_is_blocking(self):
        result = validate_installation_id("", method="actual")
        assert result.is_valid is False
        assert result.missing

    def test_actual_method_whitespace_only_is_blocking(self):
        result = validate_installation_id("   ", method="actual")
        assert result.is_valid is False
        assert result.missing

    # Format check
    def test_actual_method_valid_format_passes(self):
        result = validate_installation_id("DE_12345678", method="actual", allowlist=frozenset())
        assert result.is_valid is True
        assert result.missing == []
        assert result.warnings == []

    def test_actual_method_bad_format_warns(self):
        result = validate_installation_id("12345", method="actual", allowlist=frozenset())
        assert result.is_valid is True   # not blocking, just a warning
        assert result.missing == []
        assert len(result.warnings) == 1
        assert "installation_id_format_suspect" in result.warnings[0]
        assert "EU EUTL" in result.warnings[0]

    def test_actual_method_lowercase_prefix_warns(self):
        result = validate_installation_id("de_12345", method="actual", allowlist=frozenset())
        assert "installation_id_format_suspect" in result.warnings[0]

    # Allowlist check
    def test_id_in_allowlist_no_warning(self):
        result = validate_installation_id(
            "DE_12345678", method="actual",
            allowlist=frozenset({"DE_12345678", "FR_99999"}),
        )
        assert result.is_valid is True
        assert result.warnings == []

    def test_id_not_in_allowlist_warns(self):
        result = validate_installation_id(
            "DE_12345678", method="actual",
            allowlist=frozenset({"FR_99999"}),
        )
        assert any("installation_id_not_in_allowlist" in w for w in result.warnings)

    def test_empty_allowlist_no_allowlist_warning(self):
        result = validate_installation_id(
            "DE_12345678", method="actual",
            allowlist=frozenset(),
        )
        assert not any("not_in_allowlist" in w for w in result.warnings)

    # Goods line id prefix
    def test_goods_line_id_prefix_in_issues(self):
        result = validate_installation_id(None, method="actual", goods_line_id="gl-abc-123")
        assert "goods_line:gl-abc-123:" in result.missing[0]

    def test_no_goods_line_id_no_prefix(self):
        result = validate_installation_id(None, method="actual", goods_line_id="")
        # Should still have a missing issue, just no prefix
        assert result.missing
        assert "goods_line::" not in result.missing[0]

    # Combined warnings
    def test_bad_format_and_not_in_allowlist_both_warned(self):
        result = validate_installation_id(
            "lowercase_id", method="actual",
            allowlist=frozenset({"DE_12345"}),
        )
        assert result.is_valid is True
        assert len(result.warnings) == 2
        warning_codes = " ".join(result.warnings)
        assert "format_suspect" in warning_codes
        assert "not_in_allowlist" in warning_codes


# ── Integration with data quality ─────────────────────────────────────────────

class TestDataQualityIntegration:
    """Verify cbam_data_quality calls the registry check correctly."""

    def _run_quality(self, installation_id, method):
        from ledger_app.services.cbam_data_quality import evaluate_cbam_data_quality

        case_row = {
            "id": "case-1",
            "importer_eori": "GB1234567890000",
            "reporting_year": 2024,
            "reporting_quarter": 1,
        }
        shipments = [
            {
                "shipment": {
                    "id": "ship-1",
                    "origin_country": "DE",
                    "entry_reference": "24GB123456789000A1",
                    "incoterm": "CIF",
                },
                "goods_lines": [
                    {
                        "goods_line": {
                            "id": "gl-1",
                            "cn_code": "25232900",
                            "net_mass_kg": "1000",
                            "installation_id": installation_id,
                        },
                        "latest_emissions": {
                            "method": method,
                            "direct_embedded_kgco2e": "633",
                        },
                    }
                ],
            }
        ]
        return evaluate_cbam_data_quality(case_row, shipments)

    def test_actual_method_no_installation_id_warns_not_blocking(self):
        result = self._run_quality(installation_id=None, method="actual")
        # Registry issues are surfaced as warnings (not blocking) per transitional period rules.
        assert any(
            "installation_id_required_for_actual_method" in w for w in result["warnings"]
        )
        assert not any("installation_id_required_for_actual_method" in m for m in result["missing"])

    def test_actual_method_valid_installation_id_not_blocking(self):
        result = self._run_quality(installation_id="DE_12345678", method="actual")
        assert not any("installation_id_required" in m for m in result["missing"])

    def test_default_method_no_installation_id_not_blocking(self):
        result = self._run_quality(installation_id=None, method="default")
        # Only a warning, not a missing (blocking) issue
        assert not any("installation_id_required" in m for m in result["missing"])
        assert any("installation_id_missing" in w for w in result["warnings"])

    def test_actual_method_bad_format_id_produces_warning(self):
        result = self._run_quality(installation_id="99999", method="actual")
        assert any("format_suspect" in w for w in result["warnings"])
        # Not blocking (missing), format check is a warning
        assert not any("required_for_actual" in m for m in result["missing"])
