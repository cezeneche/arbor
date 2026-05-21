"""EU CBAM Free-Allocation Phase-In Factor.

EU 2023/956 (as amended by EU 2025/2083) phases out free ETS allocations for
CBAM sectors over 2026–2034.  During this transition, the CBAM charge is only
applied to the proportion of embedded emissions NOT covered by free allocations.

The free-allocation factor (FAF) is the fraction of emissions that remain FREE
(i.e. not subject to CBAM charge) for a given reporting year:

    CBAM_charge = embedded_tco2e × CBAM_certificate_price × (1 − FAF)

The application factor (1 − FAF) is the CBAM-chargeable fraction.

Schedule source: EU Regulation 2023/956 Annex VII, as amended by EU 2025/2083.
The schedule is uniform across all CBAM sectors.

Public API
----------
get_free_allocation_factor(year: int) → Decimal
    Free-allocation fraction for the year (0.975 in 2026 → 0.0 from 2034+).

get_cbam_application_factor(year: int) → Decimal
    Complement: 1 − free_allocation_factor (CBAM-chargeable fraction).
    e.g. 0.025 in 2026, 1.0 from 2034+.

Regulation reference
--------------------
EU Regulation 2023/956, Article 31 and Annex VII
EU Regulation 2025/2083 (amendment confirming financial-phase schedule)
"""

from __future__ import annotations

from decimal import Decimal

__all__ = [
    "get_free_allocation_factor",
    "get_cbam_application_factor",
    "EU_FREE_ALLOCATION_SCHEDULE",
    "REGULATION_REF",
]

REGULATION_REF = (
    "EU Regulation 2023/956 Article 31 + Annex VII "
    "(as amended by EU Regulation 2025/2083)"
)

# Free-allocation factor per calendar year.
# 2026 = financial phase begins; 2034 = zero free allocations (CBAM fully applies).
# Values are the fraction of ETS allocations still given FREE, expressed as Decimal.
#
# Year : free_allocation_fraction
#   2026 : 97.5%  → CBAM applies to 2.5%
#   2027 : 95.0%  → CBAM applies to 5.0%
#   2028 : 90.0%  → CBAM applies to 10.0%
#   2029 : 77.5%  → CBAM applies to 22.5%
#   2030 : 51.5%  → CBAM applies to 48.5%
#   2031 : 38.5%  → CBAM applies to 61.5%
#   2032 : 25.5%  → CBAM applies to 74.5%
#   2033 : 12.5%  → CBAM applies to 87.5%
#   2034+ : 0.0%  → CBAM applies to 100.0%
EU_FREE_ALLOCATION_SCHEDULE: dict[int, Decimal] = {
    2026: Decimal("0.975"),
    2027: Decimal("0.950"),
    2028: Decimal("0.900"),
    2029: Decimal("0.775"),
    2030: Decimal("0.515"),
    2031: Decimal("0.385"),
    2032: Decimal("0.255"),
    2033: Decimal("0.125"),
    2034: Decimal("0.000"),
}

_ZERO = Decimal("0")
_ONE  = Decimal("1")


def get_free_allocation_factor(year: int) -> Decimal:
    """Return the EU CBAM free-allocation factor for *year*.

    For years before 2026 (pre-financial phase), returns 1.0 (no CBAM charge).
    For years from 2034 onwards, returns 0.0 (full CBAM charge).

    Parameters
    ----------
    year : int
        The reporting calendar year (e.g. 2026, 2027).

    Returns
    -------
    Decimal
        Fraction of emissions covered by free allocations (0.0 – 1.0).
        Multiply embedded emissions by (1 − this value) to get the CBAM-liable portion.

    Regulation: EU 2023/956 Annex VII + EU 2025/2083.
    """
    if year < 2026:
        return _ONE    # pre-financial phase: CBAM not yet financially active
    if year >= 2034:
        return _ZERO   # from 2034: full CBAM charge (no free allocations)
    return EU_FREE_ALLOCATION_SCHEDULE[year]


def get_cbam_application_factor(year: int) -> Decimal:
    """Return the CBAM application factor (chargeable fraction) for *year*.

    This is the complement of the free-allocation factor:

        cbam_application_factor = 1 − get_free_allocation_factor(year)

    Use this to scale the CBAM charge:

        cbam_charge = embedded_tco2e × certificate_price × get_cbam_application_factor(year)

    Parameters
    ----------
    year : int
        The reporting calendar year.

    Returns
    -------
    Decimal
        Fraction of embedded emissions subject to CBAM charge (0.0 – 1.0).
        e.g. 0.025 in 2026 (only 2.5% of embedded emissions are charged).

    Regulation: EU 2023/956 Article 31 + Annex VII.
    """
    return (_ONE - get_free_allocation_factor(year)).quantize(Decimal("0.001"))
