"""Default-value mark-up schedule and free-allocation phase-out (fix F6).

Regulatory basis
----------------
Free allocation phase-out ("CBAM factor"):
    Directive 2003/87/EC Article 10a(1a), as amended by Directive (EU) 2023/959,
    applied by Regulation (EU) 2023/956 Article 31.
    The Article's "CBAM factor" is the proportion of free allocation still
    granted, NOT the chargeable share — see the note in cbam_free_allocation.py.

Default-value mark-up:
    Regulation (EU) 2023/956 Article 7(2) / Annex IV, applied to default values
    where no supplier data supports an actual figure.  10% (2026), 20% (2027),
    30% (2028 onward).  The UK regime has not confirmed an equivalent mark-up,
    so the UK schedule is explicitly unconfirmed rather than assumed to be zero.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.cbam_default_markup import (
    MARKUP_TABLE_VERSION,
    apply_default_value_markup,
    get_default_value_markup,
)
from app.services.cbam_free_allocation import (
    EU_FREE_ALLOCATION_SCHEDULE,
    get_cbam_application_factor,
    get_free_allocation_factor,
)

pytestmark = pytest.mark.regulatory


class TestFreeAllocationMatchesArticle10a1a:
    """Every year in the schedule is checked against the Directive, because a
    single wrong year silently mis-charges every consignment in that year."""

    # Directive 2003/87/EC Art. 10a(1a): free allocation remaining, by year.
    OFFICIAL = {
        2026: Decimal("0.975"),
        2027: Decimal("0.950"),
        2028: Decimal("0.900"),
        2029: Decimal("0.775"),
        2030: Decimal("0.515"),
        2031: Decimal("0.390"),
        2032: Decimal("0.265"),
        2033: Decimal("0.140"),
        2034: Decimal("0.000"),
    }

    @pytest.mark.parametrize("year", sorted(OFFICIAL))
    def test_schedule_year_matches_directive(self, year):
        assert get_free_allocation_factor(year) == self.OFFICIAL[year]

    def test_table_has_no_extra_or_missing_years(self):
        assert set(EU_FREE_ALLOCATION_SCHEDULE) == set(self.OFFICIAL)

    def test_application_factor_is_the_complement(self):
        assert get_cbam_application_factor(2033) == Decimal("0.860")
        assert get_cbam_application_factor(2031) == Decimal("0.610")
        assert get_cbam_application_factor(2032) == Decimal("0.735")

    def test_pre_2026_is_fully_free_and_2034_is_fully_charged(self):
        assert get_free_allocation_factor(2025) == Decimal("1")
        assert get_free_allocation_factor(2035) == Decimal("0")


class TestMarkupSchedule:
    def test_eu_schedule(self):
        assert get_default_value_markup(2026).fraction == Decimal("0.10")
        assert get_default_value_markup(2027).fraction == Decimal("0.20")
        assert get_default_value_markup(2028).fraction == Decimal("0.30")

    def test_eu_markup_persists_after_2028(self):
        assert get_default_value_markup(2031).fraction == Decimal("0.30")

    def test_no_markup_before_the_definitive_regime(self):
        result = get_default_value_markup(2025)
        assert result.fraction == Decimal("0")
        assert result.confirmed is True

    def test_uk_markup_is_unconfirmed_not_assumed_zero(self):
        """HMRC has not confirmed a UK mark-up. Returning 0 as though it were
        settled would silently understate a UK default-method figure."""
        result = get_default_value_markup(2027, jurisdiction="UK")
        assert result.fraction == Decimal("0")
        assert result.confirmed is False

    def test_result_carries_version_and_citation(self):
        result = get_default_value_markup(2027)
        assert result.table_version == MARKUP_TABLE_VERSION
        assert "2023/956" in result.regulation_ref

    def test_unknown_jurisdiction_is_unconfirmed(self):
        assert get_default_value_markup(2027, jurisdiction="ZZ").confirmed is False


class TestApplyMarkup:
    def test_applies_only_to_the_default_method(self):
        base = Decimal("2.000")
        assert apply_default_value_markup(base, 2027, "default") == Decimal("2.400")
        assert apply_default_value_markup(base, 2027, "actual") == base
        assert apply_default_value_markup(base, 2027, "estimated") == base

    def test_unknown_year_leaves_the_value_untouched(self):
        base = Decimal("2.000")
        assert apply_default_value_markup(base, None, "default") == base

    def test_uk_default_is_not_marked_up(self):
        base = Decimal("2.000")
        assert (
            apply_default_value_markup(base, 2027, "default", jurisdiction="UK") == base
        )


class TestSelectorAppliesMarkupToAnnexVIDefaults:
    """The mark-up must reach the figure the product actually reports."""

    CN_STEEL = "72071111"

    def _select(self, **kwargs):
        from ledger_app.services.cbam_emissions_selector import select_and_calculate

        return select_and_calculate(
            cn_code=self.CN_STEEL,
            net_mass_kg=Decimal("1000"),
            **kwargs,
        )

    def test_default_method_is_marked_up(self):
        plain = self._select()
        marked = self._select(reporting_year=2027)
        assert marked.method == "default"
        assert marked.direct_kgco2e == (plain.direct_kgco2e * Decimal("1.20")).quantize(
            Decimal("0.001")
        )

    def test_markup_version_is_stamped_on_the_result(self):
        marked = self._select(reporting_year=2027)
        assert marked.markup_table_version == MARKUP_TABLE_VERSION
        assert marked.markup_fraction == Decimal("0.20")

    def test_markup_appears_in_the_decision_trace(self):
        marked = self._select(reporting_year=2027)
        steps = [atom.step for atom in marked.decision_trace]
        assert "default_value_markup" in steps

    def test_actual_method_is_never_marked_up(self):
        result = self._select(
            direct_kgco2e_supplier=Decimal("1500"),
            indirect_kgco2e_supplier=Decimal("200"),
            supplier_direct_confidence=0.95,
            supplier_indirect_confidence=0.95,
            reporting_year=2027,
        )
        assert result.method == "actual"
        assert result.direct_kgco2e == Decimal("1500")
        assert result.markup_fraction == Decimal("0")

    def test_estimated_method_gap_fill_is_not_marked_up(self):
        """Plan §5 F6 scopes the mark-up to emissionsMethod == DEFAULT. The
        estimated path gap-fills indirect from Annex VI; whether that component
        should also carry the mark-up is an open regulatory question, so the
        current behaviour is pinned here deliberately."""
        result = self._select(
            direct_kgco2e_supplier=Decimal("1500"),
            supplier_direct_confidence=0.95,
            reporting_year=2027,
        )
        assert result.method == "estimated"
        assert result.markup_fraction == Decimal("0")

    def test_missing_reporting_year_warns_rather_than_silently_skipping(self):
        plain = self._select()
        assert plain.markup_table_version is None
        assert any("markup_not_applied" in w for w in plain.warnings)
