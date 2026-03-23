"""CBAM Carbon Price Deduction — Recognised Third-Country Schemes.

Implements the Art. 9 deduction from EU Regulation 2023/956: where a carbon
price has already been paid in the country of origin under a recognised
equivalent scheme, the CBAM liability is reduced proportionally.

Only countries *subject to CBAM* (i.e. not EU member states and not Annex II
countries IS/LI/NO/CH whose ETS is linked to the EU ETS) can appear here.

Also exposes ``check_carbon_price_plausibility`` as a convenience wrapper
around the reconciler's implementation, so callers can import from a single
carbon-pricing module without depending directly on cbam_reconciler.

Regulation references
---------------------
EU Regulation 2023/956, Article 9 — Carbon price already paid in a third country.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

# Re-export plausibility helpers from the reconciler so callers can import
# from this module without pulling in the full reconciler dependency graph.
from ledger_app.services.cbam_reconciler import (  # noqa: F401
    CarbonPriceFlag,
    check_carbon_price_plausibility,
    get_eua_reference_price,
)


@dataclass(frozen=True)
class RecognisedScheme:
    """A third-country carbon pricing mechanism recognised under EU 2023/956 Art. 9.

    Attributes
    ----------
    country_code : str
        ISO 3166-1 alpha-2 country code.
    scheme_name : str
        Official name of the carbon pricing mechanism.
    scheme_type : str
        ``"ets"`` (cap-and-trade), ``"carbon_tax"``, or ``"hybrid"``.
    regulation_ref : str
        Authoritative regulatory reference.
    notes : str
        Applicability conditions or conversion guidance.
    """

    country_code: str
    scheme_name: str
    scheme_type: str
    regulation_ref: str
    notes: str = ""


# ── Recognised schemes table (EU 2023/956 Art. 9) ────────────────────────────
#
# Countries whose ETS is *linked* to the EU ETS (Annex II: IS, LI, NO, CH)
# are excluded from CBAM entirely and must NOT appear here.
#
# This table will grow as the European Commission formally recognises further
# equivalent carbon pricing mechanisms.  See Art. 9(2) and Commission delegated
# acts for the definitive list.

_RECOGNISED_SCHEMES: dict[str, RecognisedScheme] = {
    "GB": RecognisedScheme(
        country_code="GB",
        scheme_name="UK Emissions Trading Scheme (UK ETS)",
        scheme_type="ets",
        regulation_ref=(
            "UK ETS Authority (SI 2020/1265 as amended); "
            "EU Regulation 2023/956 Art. 9 — carbon price paid in third country"
        ),
        notes=(
            "Carbon price paid = actual UK ETS allowance settlement price (GBP) "
            "converted to EUR at the ECB reference rate for the reporting quarter. "
            "Eligible for Art. 9 deduction on CBAM-covered goods of GB origin."
        ),
    ),
}


# ── Public API ────────────────────────────────────────────────────────────────


def lookup_carbon_pricing_scheme(country_code: str | None) -> Optional[RecognisedScheme]:
    """Return the recognised carbon pricing scheme for *country_code*, or None.

    Parameters
    ----------
    country_code:
        ISO 3166-1 alpha-2 country code (case-insensitive).  None or empty
        string returns None.

    Returns
    -------
    RecognisedScheme if a scheme is recognised for the country, else None.
    """
    if not country_code:
        return None
    return _RECOGNISED_SCHEMES.get(country_code.strip().upper())


def get_all_recognised_schemes() -> list[RecognisedScheme]:
    """Return all recognised third-country carbon pricing schemes.

    Returns
    -------
    list[RecognisedScheme] sorted by country_code.
    """
    return sorted(_RECOGNISED_SCHEMES.values(), key=lambda s: s.country_code)
