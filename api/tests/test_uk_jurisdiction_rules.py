"""
UK CBAM Jurisdiction Rule Tests — Items 1 and 2 of the remediation plan.

Regulatory basis:
  Finance (No.2) Bill 2025-26 — UK CBAM primary legislation
  HMRC secondary legislation, February 2026

Covered rules:
  Rule 1 — UK indirect emissions EXCLUDED
      The UK CBAM charges ONLY direct (Scope 1) embedded emissions.
      Indirect emissions (electricity, Scope 2) are out of scope until 2029
      at the earliest.  When a report package contains indirect_embedded_kgco2e
      values, the hmrc_return_builder must:
        (a) exclude them from the CBAM charge (already done — builder uses only
            direct_embedded_kgco2e), AND
        (b) emit a warning for each affected goods line.

  Rule 2 — UK-origin (GB) consignments EXCLUDED (precursor exclusion)
      UK-produced precursor goods are not subject to UK CBAM.
      Consignments where origin_country = 'GB' must be skipped entirely and
      a warning appended to return_doc.warnings.

All tests use the build_hmrc_return() function directly with in-memory
report_package dicts — no database required.
"""
from __future__ import annotations

import pytest
from decimal import Decimal

from app.services.hmrc_return_builder import (
    HMRCReturnInput,
    build_hmrc_return,
)


# ── Shared fixtures ─────────────────────────────────────────────────────────────

def _base_input(rate: Decimal = Decimal("10.00")) -> HMRCReturnInput:
    """Minimal valid HMRCReturnInput."""
    return HMRCReturnInput(
        importer_vat_number="GB123456789",
        importer_address={"line1": "1 Test St", "city": "London", "postcode": "EC1A 1AA"},
        cbam_rate_gbp_per_tco2e=rate,
        accuracy_declaration=True,
    )


def _base_package(*, origin_country: str = "DE") -> dict:
    """Minimal valid cbam_report_package_v1 with one shipment and one goods line."""
    return {
        "type": "cbam_report_package_v1",
        "case": {
            "importer_eori": "GB123456789000",
            "importer_name": "Test Steel Ltd",
            "reporting_year": 2027,
            "reporting_quarter": None,
        },
        "audit": {
            "snapshot_hash": "abc123deadbeef",
        },
        "shipments": [
            {
                "shipment": {
                    "id": "ship-001",
                    "consignment_reference": "ENS-2027-001",
                    "origin_country": origin_country,
                    "import_date": "2027-03-15",
                },
                "goods_lines": [
                    {
                        "goods_line": {
                            "id": "gl-001",
                            "cn_code": "72081000",
                            "description": "Flat-rolled steel",
                            "net_mass_kg": 10_000,
                        },
                        "latest_emissions": {
                            "method": "default",
                            "direct_embedded_kgco2e": 18_000,
                            "indirect_embedded_kgco2e": 3_000,  # electricity
                        },
                    }
                ],
            }
        ],
        "summary": {
            "total_direct_emissions_kgco2e": 18_000,
            "total_indirect_emissions_kgco2e": 3_000,
            "total_embedded_emissions_kgco2e": 21_000,
            "total_net_mass_kg": 10_000,
            "total_goods_lines": 1,
        },
    }


# ── Rule 1: UK indirect emissions exclusion ────────────────────────────────────

class TestUKIndirectEmissionsExclusion:
    """UK CBAM must only charge direct (Scope 1) embedded emissions."""

    def test_charge_uses_only_direct_emissions(self):
        """
        CBAM charge is computed from direct_embedded_kgco2e only,
        not the sum of direct + indirect.

        direct_tco2e = 18_000 kgCO2e / 1000 = 18 tCO2e
        charge = 18 tCO2e × £10.00/tCO2e = £180.00

        If indirect (3_000 kgCO2e = 3 tCO2e) were included:
        charge would be (18+3) × £10 = £210.00 — WRONG for UK CBAM.
        """
        pkg = _base_package()
        result = build_hmrc_return(pkg, _base_input(rate=Decimal("10.00")))

        assert len(result.consignments) == 1
        gl = result.consignments[0].goods_lines[0]

        # 18_000 kgCO2e ÷ 1000 = 18 tCO2e; charge = 18 × £10 = £180.00
        assert gl.direct_embedded_tco2e == Decimal("18.000000")
        assert gl.cbam_charge_gbp == Decimal("180.00")
        assert result.total_cbam_charge_gbp == Decimal("180.00")

    def test_indirect_exclusion_warning_emitted(self):
        """
        When indirect_embedded_kgco2e > 0, a uk_indirect_excluded warning
        must appear in return_doc.warnings.
        """
        pkg = _base_package()  # has 3_000 kgCO2e indirect
        result = build_hmrc_return(pkg, _base_input())

        matching_warnings = [
            w for w in result.warnings if "uk_indirect_excluded" in w
        ]
        assert matching_warnings, (
            "Expected at least one 'uk_indirect_excluded' warning in return_doc.warnings. "
            f"Got warnings: {result.warnings}"
        )

    def test_indirect_exclusion_warning_contains_kgco2e(self):
        """
        The uk_indirect_excluded warning must reference the excluded tCO2e value
        so the importer can verify the exclusion.
        """
        pkg = _base_package()
        result = build_hmrc_return(pkg, _base_input())

        indirect_warnings = [w for w in result.warnings if "uk_indirect_excluded" in w]
        assert indirect_warnings
        # 3_000 kgCO2e → 0.003 tCO2e or the kgCO2e value appears in the warning
        assert any("indirect_embedded=" in w or "0.003" in w for w in indirect_warnings)

    def test_no_indirect_warning_when_zero_indirect(self):
        """
        No uk_indirect_excluded warning should be emitted when
        indirect_embedded_kgco2e is absent or zero.
        """
        pkg = _base_package()
        # Zero out indirect emissions
        pkg["shipments"][0]["goods_lines"][0]["latest_emissions"][
            "indirect_embedded_kgco2e"
        ] = 0

        result = build_hmrc_return(pkg, _base_input())

        indirect_warnings = [w for w in result.warnings if "uk_indirect_excluded" in w]
        assert not indirect_warnings, (
            "No indirect exclusion warning expected when indirect_embedded_kgco2e=0. "
            f"Got: {indirect_warnings}"
        )

    def test_indirect_zero_does_not_affect_charge(self):
        """
        When indirect is zero, the charge equals direct × rate exactly.
        """
        pkg = _base_package()
        pkg["shipments"][0]["goods_lines"][0]["latest_emissions"][
            "indirect_embedded_kgco2e"
        ] = 0

        result = build_hmrc_return(pkg, _base_input(rate=Decimal("50.00")))

        gl = result.consignments[0].goods_lines[0]
        # 18_000 kgCO2e ÷ 1000 = 18 tCO2e; charge = 18 × £50 = £900.00
        assert gl.direct_embedded_tco2e == Decimal("18.000000")
        assert gl.cbam_charge_gbp == Decimal("900.00")


# ── Rule 2: UK precursor exclusion ────────────────────────────────────────────

class TestUKPrecursorExclusion:
    """UK-origin (origin_country='GB') consignments must be excluded from the return."""

    def test_gb_consignment_excluded_from_return(self):
        """
        A consignment with origin_country='GB' must be completely excluded
        from return_doc.consignments (UK-produced goods are not subject to UK CBAM).
        """
        pkg = _base_package(origin_country="GB")
        result = build_hmrc_return(pkg, _base_input())

        assert result.consignments == [], (
            "Consignment with origin_country='GB' must not appear in the HMRC return. "
            f"Got consignments: {result.consignments}"
        )

    def test_gb_consignment_produces_warning(self):
        """
        When a GB-origin consignment is excluded, a uk_precursor_excluded warning
        must appear in return_doc.warnings.
        """
        pkg = _base_package(origin_country="GB")
        result = build_hmrc_return(pkg, _base_input())

        matching = [w for w in result.warnings if "uk_precursor_excluded" in w]
        assert matching, (
            "Expected a 'uk_precursor_excluded' warning for origin_country='GB'. "
            f"Got warnings: {result.warnings}"
        )

    def test_gb_exclusion_warning_contains_consignment_ref(self):
        """
        The uk_precursor_excluded warning must reference the consignment reference
        so the operator can identify which consignment was excluded.
        """
        pkg = _base_package(origin_country="GB")
        result = build_hmrc_return(pkg, _base_input())

        precursor_warnings = [w for w in result.warnings if "uk_precursor_excluded" in w]
        assert any("ENS-2027-001" in w for w in precursor_warnings), (
            "Expected consignment reference 'ENS-2027-001' in the precursor exclusion warning. "
            f"Got: {precursor_warnings}"
        )

    def test_gb_consignment_zero_liability(self):
        """
        Excluding GB-origin consignments results in zero total CBAM liability.
        """
        pkg = _base_package(origin_country="GB")
        result = build_hmrc_return(pkg, _base_input())

        assert result.total_cbam_charge_gbp == Decimal("0")
        assert result.total_cbam_liability_gbp == Decimal("0")

    def test_non_gb_consignment_not_excluded(self):
        """
        Non-GB consignments must NOT be affected by the precursor exclusion logic.
        """
        for origin in ("DE", "FR", "CN", "UA", "IN", "TR"):
            pkg = _base_package(origin_country=origin)
            result = build_hmrc_return(pkg, _base_input())

            assert result.consignments, (
                f"Consignment with origin_country={origin!r} must NOT be excluded. "
                "Only origin_country='GB' triggers the UK precursor exclusion."
            )

    def test_mixed_origins_only_gb_excluded(self):
        """
        When a report package has multiple shipments — one from GB, one from DE —
        only the GB consignment is excluded; the DE consignment must be included.
        """
        pkg = _base_package(origin_country="DE")  # DE consignment
        # Add a second GB consignment
        gb_shipment = {
            "shipment": {
                "id": "ship-002",
                "consignment_reference": "ENS-2027-002",
                "origin_country": "GB",
                "import_date": "2027-04-01",
            },
            "goods_lines": [
                {
                    "goods_line": {
                        "id": "gl-002",
                        "cn_code": "72082500",
                        "description": "UK-origin steel coil",
                        "net_mass_kg": 5_000,
                    },
                    "latest_emissions": {
                        "method": "default",
                        "direct_embedded_kgco2e": 9_000,
                        "indirect_embedded_kgco2e": 0,
                    },
                }
            ],
        }
        pkg["shipments"].append(gb_shipment)

        result = build_hmrc_return(pkg, _base_input())

        consignment_refs = [c.consignment_reference for c in result.consignments]
        assert "ENS-2027-001" in consignment_refs, "DE consignment must be included"
        assert "ENS-2027-002" not in consignment_refs, "GB consignment must be excluded"
        assert len(result.consignments) == 1

        # Warning present for GB exclusion
        assert any("uk_precursor_excluded" in w for w in result.warnings)
        assert any("uk_indirect_excluded" in w for w in result.warnings)

    def test_gb_lowercase_also_excluded(self):
        """
        The exclusion logic must be case-insensitive ('gb', 'GB', 'Gb' all excluded).
        """
        for variant in ("gb", "Gb", "gB"):
            pkg = _base_package(origin_country=variant)
            result = build_hmrc_return(pkg, _base_input())
            assert result.consignments == [], (
                f"Expected consignments=[] for origin_country={variant!r}. "
                f"Got {result.consignments}"
            )
