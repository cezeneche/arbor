"""The Nucleos emissions axis is never called a "tier" (fix F5).

Arbor carries provenanceTier (VERIFIED | DECLARED | ESTIMATED) — how much to
trust a record's origin. Nucleos carries emissionsMethod (ACTUAL | ESTIMATED |
DEFAULT) — which emissions value entered the calculation. They are orthogonal:
a mill certificate can legitimately be ACTUAL method and DECLARED provenance.
Both travel on every goods line, so a bare "tier" on the Nucleos side reads as
the Arbor axis and will eventually be collapsed into it by someone.

EU 2023/1773 Art. 4 does number its methods as tiers. That numbering is kept,
but only as an explicit regulatory citation field — never as the axis name.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from ledger_app.services.cbam_emissions_selector import (
    MethodSelectionResult,
    select_and_calculate,
)

pytestmark = pytest.mark.regulatory

CN_STEEL = "72071111"


class TestRejectionReasonsNaming:
    def test_result_exposes_rejected_method_reasons(self):
        result = select_and_calculate(cn_code=CN_STEEL, net_mass_kg=Decimal("1000"))
        assert hasattr(result, "rejected_method_reasons")

    def test_the_old_tier_named_field_is_gone(self):
        assert not hasattr(MethodSelectionResult, "tier_rejection_reasons")
        assert "tier_rejection_reasons" not in MethodSelectionResult.__annotations__

    def test_each_rejection_names_the_method_not_a_bare_tier(self):
        result = select_and_calculate(cn_code=CN_STEEL, net_mass_kg=Decimal("1000"))
        assert result.method == "default"
        assert result.rejected_method_reasons

        for entry in result.rejected_method_reasons:
            assert entry["method"] in ("actual", "estimated")
            assert "tier" not in entry
            assert entry["reason"]
            assert entry["regulation_ref"]

    def test_regulatory_tier_number_is_retained_as_a_citation(self):
        """The Art. 4 numbering is still recorded — under a name that cannot be
        mistaken for the provenance axis."""
        result = select_and_calculate(cn_code=CN_STEEL, net_mass_kg=Decimal("1000"))
        numbers = {e["regulation_tier"] for e in result.rejected_method_reasons}
        assert numbers == {1, 2}

    def test_actual_method_records_no_rejections(self):
        result = select_and_calculate(
            cn_code=CN_STEEL,
            net_mass_kg=Decimal("1000"),
            direct_kgco2e_supplier=Decimal("1500"),
            indirect_kgco2e_supplier=Decimal("200"),
            supplier_direct_confidence=0.95,
            supplier_indirect_confidence=0.95,
        )
        assert result.method == "actual"
        assert result.rejected_method_reasons == []
