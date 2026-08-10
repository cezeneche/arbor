"""UK CBAM placeholder rates must fail closed (integration plan fix F1).

Regulatory basis:
  Finance (No.2) Bill 2025-26 — UK CBAM primary legislation.
  HMRC publishes the operative quarterly rate via Government Gateway.

The rate table ships engineering placeholders derived from an assumed
£45/tCO2e UK ETS price so the product can be exercised before HMRC
publishes.  A placeholder must never reach a customer-visible liability
figure: an unbacked number is a worse failure than a missing one, because
a missing number is visible and a wrong one is not.

Two guarantees are tested here:
  1. The rate lookup rejects placeholders unless the caller opts in.
  2. A liability total computed from any placeholder rate is withheld and
     reports what is missing, rather than rendering as a number.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.cbam_uk_rates import (
    UKCBAMRateMissing,
    UKCBAMRatePlaceholder,
    get_uk_cbam_rate,
    get_uk_cbam_rate_entry,
    get_uk_cbam_rate_or_raise,
)

pytestmark = pytest.mark.regulatory


class TestRateLookupFailsClosed:
    def test_or_raise_rejects_placeholder_by_default(self):
        """No kwargs = safe. A caller must opt in to placeholder-derived rates."""
        with pytest.raises(UKCBAMRatePlaceholder):
            get_uk_cbam_rate_or_raise("iron_steel", 2027, None)

    def test_or_raise_returns_placeholder_only_on_explicit_opt_in(self):
        rate = get_uk_cbam_rate_or_raise(
            "iron_steel", 2027, None, reject_placeholder=False
        )
        # £45 × (1 − 0.85)
        assert rate == Decimal("6.75")

    def test_missing_period_still_raises_missing_not_placeholder(self):
        with pytest.raises(UKCBAMRateMissing):
            get_uk_cbam_rate_or_raise("iron_steel", 2031, 2)

    def test_entry_lookup_exposes_provenance(self):
        entry = get_uk_cbam_rate_entry("iron_steel", 2027, None)
        assert entry is not None
        assert entry.source == "placeholder"
        assert entry.is_placeholder is True

    def test_entry_lookup_returns_none_for_unknown_period(self):
        assert get_uk_cbam_rate_entry("iron_steel", 2031, 2) is None

    def test_plain_lookup_still_returns_value_for_planning(self):
        """get_uk_cbam_rate stays non-raising — callers check provenance themselves."""
        assert get_uk_cbam_rate("iron_steel", 2027, None) == Decimal("6.75")


class TestLiabilityWithholdsPlaceholderDerivedTotals:
    """The case-list exposure figure must not render a placeholder-backed number."""

    def test_placeholder_rate_withholds_the_total(self):
        from ledger_app.api.cbam.cases import _case_liability

        total, unavailable = _case_liability(
            [("iron_steel", Decimal("1000"), Decimal("500"))], 2027, None
        )
        assert total is None
        assert unavailable is not None
        assert unavailable["reason"] == "placeholder_rate"
        assert "iron_steel" in unavailable["sectors"]

    def test_reason_names_what_is_missing(self):
        from ledger_app.api.cbam.cases import _case_liability

        _, unavailable = _case_liability(
            [("iron_steel", Decimal("1000"), Decimal("500"))], 2027, None
        )
        assert "HMRC" in unavailable["detail"]

    def test_unknown_period_falls_back_to_the_2027_annual_entry(self):
        """Pre-existing behaviour: an unpriced period falls back to 2027 annual.
        That entry is a placeholder, so the total is still withheld."""
        from ledger_app.api.cbam.cases import _case_liability

        total, unavailable = _case_liability(
            [("iron_steel", Decimal("1000"), Decimal("500"))], 2031, 2
        )
        assert total is None
        assert unavailable["reason"] == "placeholder_rate"

    def test_sector_with_no_rate_entry_is_reported_not_silently_dropped(self):
        """'electricity' carries a rough SEE default but has no UK rate table
        entry. It previously contributed nothing to the total with no signal,
        understating exposure silently."""
        from ledger_app.api.cbam.cases import _case_liability

        total, unavailable = _case_liability(
            [("electricity", Decimal("0"), Decimal("5000"))], 2027, None
        )
        assert total is None
        assert unavailable["reason"] == "no_published_rate"
        assert "electricity" in unavailable["sectors"]

    def test_zero_emissions_yields_no_total_and_no_placeholder_claim(self):
        from ledger_app.api.cbam.cases import _case_liability

        total, unavailable = _case_liability(
            [("iron_steel", Decimal("0"), Decimal("0"))], 2027, None
        )
        assert total is None
        assert unavailable is None

    def test_rough_default_mass_fallback_is_still_placeholder_blocked(self):
        """Mass-only lines fall back to a rough SEE default, then hit the same
        placeholder rate — the total must still be withheld."""
        from ledger_app.api.cbam.cases import _case_liability

        total, unavailable = _case_liability(
            [("aluminium", Decimal("0"), Decimal("2000"))], 2027, None
        )
        assert total is None
        assert unavailable["reason"] == "placeholder_rate"
