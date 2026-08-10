"""CPR reference data is versioned, shipped, and insert-never-update.

Phase 3. Qualifying schemes and exchange rates are facts about the world every
tenant shares, not tenant data. A relief figure stamped with a table version can
be reproduced years later — which matters because HMRC republishes, and a
recomputation that silently used today's list would not match the return filed.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.services.cpr_reference import (
    CPR_REFERENCE_METADATA,
    CPR_REFERENCE_VERSION,
    EXCHANGE_RATES,
    ExchangeRateUnavailable,
    get_reference_exchange_rate,
)

pytestmark = pytest.mark.regulatory


class TestLookup:
    def test_returns_the_rate_effective_on_the_date(self):
        rate, effective, source = get_reference_exchange_rate("EUR", date(2026, 5, 15))
        assert rate == Decimal("0.8365")
        assert effective == date(2026, 4, 1)
        assert "HMRC" in source

    def test_uses_the_most_recent_rate_on_or_before_the_date(self):
        _, effective, _ = get_reference_exchange_rate("EUR", date(2026, 7, 1))
        assert effective == date(2026, 7, 1)

    def test_the_effective_date_travels_with_the_rate(self):
        """A figure has to record which published rate produced it, not merely
        that some conversion happened."""
        _, effective, _ = get_reference_exchange_rate("USD", date(2026, 2, 1))
        assert effective == date(2026, 1, 1)

    def test_same_currency_needs_no_conversion(self):
        rate, _, source = get_reference_exchange_rate("GBP", date(2026, 5, 1))
        assert rate == Decimal("1")
        assert source == "identity"

    def test_a_date_before_any_published_rate_raises(self):
        # Never defaults to 1.0: a claim converted at an invented rate is a wrong
        # number that looks right.
        with pytest.raises(ExchangeRateUnavailable):
            get_reference_exchange_rate("EUR", date(2025, 6, 1))

    def test_an_unknown_currency_raises(self):
        with pytest.raises(ExchangeRateUnavailable):
            get_reference_exchange_rate("ZWL", date(2026, 5, 1))

    def test_the_error_names_the_currency_and_the_table_version(self):
        with pytest.raises(ExchangeRateUnavailable) as exc:
            get_reference_exchange_rate("ZWL", date(2026, 5, 1))
        assert "ZWL" in str(exc.value)
        assert CPR_REFERENCE_VERSION in str(exc.value)


class TestVersioning:
    def test_the_table_carries_a_version_and_a_fingerprint(self):
        assert CPR_REFERENCE_METADATA["table_version"] == CPR_REFERENCE_VERSION
        assert CPR_REFERENCE_METADATA["table_sha256"]
        assert CPR_REFERENCE_METADATA["discipline"] == "insert-never-update"

    def test_no_currency_pair_repeats_an_effective_date(self):
        """Two rows with the same key and date means one silently wins."""
        keys = [(r.from_currency, r.to_currency, r.effective_from) for r in EXCHANGE_RATES]
        assert len(keys) == len(set(keys))

    def test_every_rate_is_a_positive_decimal(self):
        for rate in EXCHANGE_RATES:
            assert isinstance(rate.rate, Decimal)
            assert rate.rate > 0

    def test_the_fingerprint_tracks_the_contents(self):
        import hashlib
        import json

        recomputed = hashlib.sha256(
            json.dumps(
                [
                    [r.from_currency, r.to_currency, r.effective_from.isoformat(), str(r.rate)]
                    for r in EXCHANGE_RATES
                ],
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest()
        assert recomputed == CPR_REFERENCE_METADATA["table_sha256"]
