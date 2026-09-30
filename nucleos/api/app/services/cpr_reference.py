"""Versioned reference data for Carbon Price Relief.

Qualifying schemes and exchange rates are **regulatory reference data, not
tenant data**. Which schemes HMRC recognises, and what HMRC's published rate was
on a given day, are facts about the world that every tenant shares. Holding them
in a tenant-scoped table invites a per-tenant answer to a question that has only
one.

Versioning follows the Annex VI factor table: rows are inserted, never updated.
A relief figure stamped with CPR_REFERENCE_VERSION can be reproduced years later,
which is the whole point of stamping it — HMRC republishes, and a recomputation
that silently used today's list would not match the return that was filed.

Regulation references
---------------------
Finance (No.2) Bill 2025-26 — UK CBAM, carbon price relief
HMRC published monthly exchange rates (used for customs valuation)
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.services.hmrc_exchange_rates import SOURCE as HMRC_SOURCE
from app.services.hmrc_exchange_rates import gbp_per_unit
from app.services.hmrc_exchange_rates_data import HMRC_MONTHLY_UNITS_PER_GBP

__all__ = [
    "CPR_REFERENCE_VERSION",
    "CPR_REFERENCE_METADATA",
    "ExchangeRate",
    "EXCHANGE_RATES",
    "get_reference_exchange_rate",
    "ExchangeRateUnavailable",
]




class ExchangeRateUnavailable(LookupError):
    """No published rate is held for the currency on or before the date.

    Raised rather than defaulting to 1.0 or to the nearest later rate. A relief
    claim converted at an invented rate is a wrong number that looks right, and
    the caller has to be able to tell "no rate" from "a rate of one".
    """

    def __init__(self, from_currency: str, target_date: date) -> None:
        super().__init__(
            f"No published exchange rate for {from_currency}->GBP on or before "
            f"{target_date.isoformat()} in CPR reference table {CPR_REFERENCE_VERSION}."
        )


@dataclass(frozen=True)
class ExchangeRate:
    """One published rate, effective from a date until the next one supersedes it."""

    from_currency: str
    to_currency: str
    effective_from: date
    rate: Decimal
    source: str
    # HMRC's own published figure, from which rate is derived.
    units_per_gbp: Decimal | None = None


# HMRC's published monthly rates, one row per currency per month, loaded from
# the generated module scripts/update_hmrc_rates.py maintains. Insert-never-
# update: a month once held is never rewritten, and the version names the
# latest month, so a relief figure stamped with it can be reproduced later.
EXCHANGE_RATES: tuple[ExchangeRate, ...] = tuple(
    ExchangeRate(
        from_currency=code,
        to_currency="GBP",
        effective_from=date(int(month[:4]), int(month[5:]), 1),
        rate=gbp_per_unit(Decimal(units)),
        source=HMRC_SOURCE,
        units_per_gbp=Decimal(units),
    )
    for month, code, units in HMRC_MONTHLY_UNITS_PER_GBP
)

CPR_REFERENCE_VERSION = f"hmrc-monthly-{max(month for month, _, _ in HMRC_MONTHLY_UNITS_PER_GBP)}"

_TABLE_SHA256 = hashlib.sha256(
    json.dumps(
        [
            [r.from_currency, r.to_currency, r.effective_from.isoformat(), str(r.rate)]
            for r in EXCHANGE_RATES
        ],
        sort_keys=True,
    ).encode("utf-8")
).hexdigest()

CPR_REFERENCE_METADATA = {
    "table_version": CPR_REFERENCE_VERSION,
    "regulation": "Finance (No.2) Bill 2025-26 — UK CBAM carbon price relief",
    "exchange_rate_source": "HMRC published monthly exchange rates",
    "discipline": "insert-never-update",
    "table_sha256": _TABLE_SHA256,
}


def get_reference_exchange_rate(
    from_currency: str,
    target_date: date,
    to_currency: str = "GBP",
) -> tuple[Decimal, date, str]:
    """Most recent published rate on or before *target_date*.

    Returns ``(rate, effective_date, source)``. The effective date travels with
    the rate so a relief figure records which published rate produced it, not
    merely that some conversion happened.
    """
    src = (from_currency or "").strip().upper()
    dst = (to_currency or "GBP").strip().upper()

    if src == dst:
        return Decimal("1"), target_date, "identity"

    candidates = [
        r
        for r in EXCHANGE_RATES
        if r.from_currency == src and r.to_currency == dst and r.effective_from <= target_date
    ]
    if not candidates:
        raise ExchangeRateUnavailable(src, target_date)

    latest = max(candidates, key=lambda r: r.effective_from)
    return latest.rate, latest.effective_from, latest.source
