"""UK CBAM Rate Lookup — quarterly HMRC-published rates.

The UK CBAM rate (£/tCO₂e) is derived from the UK ETS quarterly average price,
adjusted for the sector-specific free-allocation factor:

    cbam_rate = uk_ets_price × (1 − free_allocation_factor_for_sector)

Per the Finance (No.2) Bill 2025-26, HMRC publishes the operative rate each
quarter via Government Gateway.  This module holds the reference table and
exposes a lookup function.

IMPORTANT: rates are populated as HMRC publishes them.  Rows marked with
``source="placeholder"`` are engineering estimates only and MUST be replaced
with HMRC-published figures before use in a real HMRC return.

Sectors (CN8 prefixes map to these sector codes):
  iron_steel      7206, 7207, 7208–7229, 7301, 7302, 7304–7306
  aluminium       7601, 7602, 7603, 7604, 7605, 7606, 7607, 7608, 7609
  cement          2523, 6810, 6811
  fertilisers     2808, 2814, 2834, 3102, 3105
  hydrogen        2804

Public API
----------
get_uk_cbam_rate(sector, year, quarter) → Decimal | None
    Return the HMRC-published CBAM rate (£/tCO₂e) for the given period,
    or None if no rate has been entered yet.
    sector must match the canonical DB name: "iron_steel", "aluminium", etc.

get_uk_cbam_rate_or_raise(sector, year, quarter) → Decimal
    Raises UKCBAMRateMissing if no rate is found.

get_sector_for_cn8(cn8_code) → str | None
    Map an 8-digit CN code to its UK CBAM sector code.

Regulation references
---------------------
Finance (No.2) Bill 2025-26 (UK CBAM primary legislation)
HMRC Government Gateway — CBAM quarterly rate notices
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import NamedTuple

__all__ = [
    "UKCBAMRateMissing",
    "UKCBAMRateEntry",
    "get_uk_cbam_rate",
    "get_uk_cbam_rate_or_raise",
    "get_sector_for_cn8",
    "UK_CBAM_SECTORS",
]


class UKCBAMRateMissing(KeyError):
    """Raised when no HMRC-published CBAM rate exists for the requested period."""

    def __init__(self, sector: str, year: int, quarter: int | None) -> None:
        period = f"Q{quarter} {year}" if quarter else f"{year} Annual"
        super().__init__(
            f"No UK CBAM rate found for sector={sector!r} period={period!r}. "
            "Check HMRC Government Gateway for the published quarterly rate."
        )


@dataclass(frozen=True)
class UKCBAMRateEntry:
    """One UK CBAM rate record."""
    sector:         str
    year:           int
    quarter:        int | None   # None = annual (2027 first return is annual)
    rate_gbp_per_tco2e: Decimal
    source:         str          # "hmrc_published" | "placeholder"
    notes:          str = ""


# ── Sector → CN8 prefix mapping ────────────────────────────────────────────────

# Maps sector code → list of CN4 / CN6 prefixes (first N digits of CN8)
# Source: UK CBAM (Finance No.2 Bill 2025-26) Schedule 1
UK_CBAM_SECTORS: dict[str, list[str]] = {
    "iron_steel": [
        "7206", "7207",
        "7208", "7209", "7210", "7211", "7212", "7213", "7214", "7215", "7216",
        "7217", "7218", "7219", "7220", "7221", "7222", "7223", "7224", "7225",
        "7226", "7227", "7228", "7229",
        "7301", "7302", "7303", "7304", "7305", "7306",
    ],
    "aluminium": [
        "7601", "7602", "7603", "7604", "7605", "7606", "7607", "7608", "7609",
        "7610", "7611", "7612", "7613", "7614", "7615", "7616",
    ],
    "cement": ["2523", "6810", "6811"],
    "fertilisers": ["2808", "2814", "2834", "3101", "3102", "3103", "3104", "3105"],
    "hydrogen": ["2804"],
}


def get_sector_for_cn8(cn8_code: str) -> str | None:
    """Map an 8-digit CN code to its UK CBAM sector, or None if not in scope."""
    code = str(cn8_code or "").strip()
    for sector, prefixes in UK_CBAM_SECTORS.items():
        for prefix in prefixes:
            if code.startswith(prefix):
                return sector
    return None


# ── Rate table ─────────────────────────────────────────────────────────────────
#
# HMRC publishes rates quarterly via Government Gateway notices.
# UK CBAM goes live 1 January 2027; first return is annual (due 31 May 2028).
# Quarterly returns start from Q1 2028 (due 31 March 2028 — 2 months after Q end).
#
# Until HMRC publishes official rates, entries are marked source="placeholder"
# with engineering-estimate values.  These MUST be replaced with official figures.
#
# Engineering estimate basis (placeholder rates):
#   Assumed UK ETS price ≈ £45/tCO₂e (2027 annual average estimate)
#   Free allocation factor: iron_steel ≈ 0.85, aluminium ≈ 0.80, cement ≈ 0.75,
#                           fertilisers ≈ 0.70, hydrogen ≈ 0.65
#   cbam_rate = uk_ets_price × (1 - free_alloc)

_RATES: list[UKCBAMRateEntry] = [
    # 2027 Annual return (Finance No.2 Bill 2025-26 transitional first year)
    UKCBAMRateEntry("iron_steel",  2027, None, Decimal("6.75"),  "placeholder",
                    "Estimate: £45 × (1−0.85); replace with HMRC Q4-2027 notice"),
    UKCBAMRateEntry("aluminium",   2027, None, Decimal("9.00"),  "placeholder",
                    "Estimate: £45 × (1−0.80); replace with HMRC Q4-2027 notice"),
    UKCBAMRateEntry("cement",      2027, None, Decimal("11.25"), "placeholder",
                    "Estimate: £45 × (1−0.75); replace with HMRC Q4-2027 notice"),
    UKCBAMRateEntry("fertilisers", 2027, None, Decimal("13.50"), "placeholder",
                    "Estimate: £45 × (1−0.70); replace with HMRC Q4-2027 notice"),
    UKCBAMRateEntry("hydrogen",    2027, None, Decimal("15.75"), "placeholder",
                    "Estimate: £45 × (1−0.65); replace with HMRC Q4-2027 notice"),
]

# Build lookup dict: (sector, year, quarter) → UKCBAMRateEntry
_RATE_INDEX: dict[tuple[str, int, int | None], UKCBAMRateEntry] = {
    (e.sector, e.year, e.quarter): e for e in _RATES
}


def get_uk_cbam_rate(
    sector: str,
    year: int,
    quarter: int | None = None,
) -> Decimal | None:
    """Return the UK CBAM rate (£/tCO₂e) for the given sector and period.

    Parameters
    ----------
    sector : str
        UK CBAM sector code: "steel" | "aluminium" | "cement" | "fertilisers" | "hydrogen"
    year : int
        Reporting year (e.g. 2027).
    quarter : int | None
        1–4 for quarterly returns (2028+); None for annual returns (2027).

    Returns
    -------
    Decimal | None
        The HMRC-published (or estimated placeholder) rate, or None when no
        rate has been entered for that period.
    """
    entry = _RATE_INDEX.get((sector.lower(), year, quarter))
    return entry.rate_gbp_per_tco2e if entry else None


def get_uk_cbam_rate_or_raise(
    sector: str,
    year: int,
    quarter: int | None = None,
) -> Decimal:
    """Return the UK CBAM rate or raise UKCBAMRateMissing.

    Use this when a missing rate should halt processing (e.g. report generation).
    For planning / informational use, prefer ``get_uk_cbam_rate`` which returns None.
    """
    rate = get_uk_cbam_rate(sector, year, quarter)
    if rate is None:
        raise UKCBAMRateMissing(sector, year, quarter)
    return rate
