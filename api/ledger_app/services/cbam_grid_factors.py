"""CBAM Country-Specific Electricity Grid Emission Factors.

Provides country-level electricity emission factors (tCO2e/MWh) required for
computing indirect embedded emissions in:
  - Aluminium (primary and secondary — Annex VI, Table 3)
  - Fertilisers produced via Haber-Bosch process (ammonia/urea/nitric acid)
  - Electricity sector reporting (direct scope)

Source
------
- EU Commission Implementing Regulation 2023/1773, Annex VI, Table 3
  ("Default values for the electricity emission factor for transitional period")
- IEA World Energy Outlook 2023 (supplementary country data where EU table absent)
- IPCC AR6 WG3 (2022) Chapter 6, Table A.III.2 (long-run estimates)

Regulation references
---------------------
EU Regulation 2023/956, Annex I — CBAM product scope
Commission Implementing Regulation 2023/1773:
  - Article 7(3) — indirect embedded emissions from electricity
  - Annex VI, Table 3 — default electricity emission factors by country
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

_D = Decimal
_ZERO = _D("0")

# ── Grid emission factor table ────────────────────────────────────────────────
#
# Format: ISO 3166-1 alpha-2 → tCO2e/MWh (Decimal)
#
# Source: EU 2023/1773 Annex VI Table 3 (primary); IEA 2023 (supplementary).
# Values represent grid-average emission intensity.
# Renewable-only or hydro-dominant grids have lower values.
# Coal-dominant grids (CN, IN, ZA, PL) have higher values.
#
# Note: where the EU table does not publish a country-specific value, the
# IEA world average (WORLD_AVG) applies per Art. 7(3).

_GRID_FACTORS: dict[str, Decimal] = {
    # ── CBAM-relevant non-EU origin countries ────────────────────────────────
    # Major CBAM export economies listed first (highest import volumes to EU)

    "CN": _D("0.5810"),   # China — coal-heavy, National Grid (IEA 2023)
    "IN": _D("0.7090"),   # India — coal + gas dominant (IEA 2023)
    "RU": _D("0.3220"),   # Russia — gas + hydro (IEA 2023)
    "UA": _D("0.3490"),   # Ukraine — nuclear + gas mix (IEA 2023)
    "TR": _D("0.4530"),   # Turkey — gas + coal + renewables (IEA 2023)
    "EG": _D("0.4600"),   # Egypt — gas dominant (IEA 2023)
    "MA": _D("0.7100"),   # Morocco — coal + gas (IEA 2023)
    "DZ": _D("0.5100"),   # Algeria — gas dominant (IEA 2023)
    "TN": _D("0.5200"),   # Tunisia — gas dominant (IEA 2023)
    "ZA": _D("0.8280"),   # South Africa — coal dominant (IEA 2023 / Annex VI)
    "KZ": _D("0.7800"),   # Kazakhstan — coal + gas (IEA 2023)
    "UZ": _D("0.5900"),   # Uzbekistan — gas dominant (IEA 2023)
    "BY": _D("0.3100"),   # Belarus — gas + nuclear (IEA 2023)
    "MK": _D("0.6700"),   # North Macedonia — coal + hydro (IEA 2023)
    "RS": _D("0.6400"),   # Serbia — coal dominant (IEA 2023)
    "BA": _D("0.7300"),   # Bosnia-Herzegovina — coal dominant (IEA 2023)
    "AL": _D("0.0300"),   # Albania — near-100% hydro (IEA 2023)
    "MD": _D("0.4200"),   # Moldova — gas (IEA 2023)
    "GE": _D("0.1200"),   # Georgia — hydro dominant (IEA 2023)
    "AM": _D("0.2800"),   # Armenia — nuclear + hydro (IEA 2023)
    "AZ": _D("0.4900"),   # Azerbaijan — gas dominant (IEA 2023)
    "KG": _D("0.0800"),   # Kyrgyzstan — hydro dominant (IEA 2023)
    "TJ": _D("0.0600"),   # Tajikistan — hydro dominant (IEA 2023)
    "IR": _D("0.5300"),   # Iran — gas dominant (IEA 2023)
    "SA": _D("0.6400"),   # Saudi Arabia — oil + gas (IEA 2023)
    "AE": _D("0.3600"),   # UAE — gas + nuclear (IEA 2023)
    "KW": _D("0.6200"),   # Kuwait — oil + gas (IEA 2023)
    "QA": _D("0.4000"),   # Qatar — gas dominant (IEA 2023)
    "OM": _D("0.5800"),   # Oman — gas dominant (IEA 2023)
    "BH": _D("0.5700"),   # Bahrain — gas dominant (IEA 2023)
    "IQ": _D("0.5200"),   # Iraq — gas + oil (IEA 2023)
    "JO": _D("0.5600"),   # Jordan — gas (IEA 2023)
    "LB": _D("0.6800"),   # Lebanon — oil (IEA 2023)
    "SY": _D("0.5000"),   # Syria — gas (IEA 2023)
    "PK": _D("0.4600"),   # Pakistan — gas + coal + hydro (IEA 2023)
    "BD": _D("0.5700"),   # Bangladesh — gas dominant (IEA 2023)
    "ID": _D("0.7000"),   # Indonesia — coal dominant (IEA 2023)
    "VN": _D("0.4800"),   # Vietnam — coal + hydro (IEA 2023)
    "TH": _D("0.4800"),   # Thailand — gas + coal (IEA 2023)
    "MY": _D("0.5800"),   # Malaysia — gas + coal (IEA 2023)
    "KR": _D("0.4100"),   # South Korea — nuclear + coal + gas (IEA 2023)
    "JP": _D("0.4330"),   # Japan — gas + coal + nuclear (IEA 2023)
    "AU": _D("0.5100"),   # Australia — coal dominant (IEA 2023)
    "US": _D("0.3860"),   # USA — gas + coal + nuclear + renewables (IEA 2023)
    "CA": _D("0.1300"),   # Canada — hydro + nuclear dominant (IEA 2023)
    "BR": _D("0.0730"),   # Brazil — hydro dominant (IEA 2023)
    "MX": _D("0.4400"),   # Mexico — gas + coal (IEA 2023)
    "AR": _D("0.3200"),   # Argentina — gas + hydro (IEA 2023)
    "CL": _D("0.3200"),   # Chile — gas + coal + renewables (IEA 2023)
    "CO": _D("0.2000"),   # Colombia — hydro dominant (IEA 2023)
    "PE": _D("0.1800"),   # Peru — hydro dominant (IEA 2023)
    "ZW": _D("0.6900"),   # Zimbabwe — coal + hydro (IEA 2023)
    "ZM": _D("0.0800"),   # Zambia — hydro dominant (IEA 2023)
    "NG": _D("0.4300"),   # Nigeria — gas (IEA 2023)
    "KE": _D("0.0650"),   # Kenya — geothermal + hydro (IEA 2023)
    "ET": _D("0.0400"),   # Ethiopia — hydro dominant (IEA 2023)

    # ── EU member states (informational — EU goods not subject to CBAM) ──────
    "DE": _D("0.3850"),   # Germany (IEA 2023)
    "FR": _D("0.0510"),   # France — nuclear dominant (IEA 2023)
    "PL": _D("0.7180"),   # Poland — coal dominant (IEA 2023)
    "ES": _D("0.2030"),   # Spain (IEA 2023)
    "IT": _D("0.2350"),   # Italy (IEA 2023)
    "SE": _D("0.0130"),   # Sweden — hydro + nuclear (IEA 2023)
    "FI": _D("0.0740"),   # Finland — nuclear + hydro (IEA 2023)
    "AT": _D("0.0780"),   # Austria — hydro dominant (IEA 2023)

    # ── UK (ETS-linked, Art. 9 eligible) ─────────────────────────────────────
    "GB": _D("0.2070"),   # UK — gas + nuclear + renewables (IEA 2023)

    # ── Global reference ──────────────────────────────────────────────────────
    "WORLD_AVG": _D("0.4940"),  # IEA world average (2023 World Energy Outlook)
}


# ── Public API ────────────────────────────────────────────────────────────────

def get_grid_factor(country_code: str | None) -> Decimal:
    """Return the electricity grid emission factor for *country_code* (tCO2e/MWh).

    Parameters
    ----------
    country_code:
        ISO 3166-1 alpha-2 country code (case-insensitive).
        When None, empty, or not found, the IEA world average is returned.

    Returns
    -------
    Decimal — tCO2e per MWh.  Always > 0.
    """
    if not country_code:
        return _GRID_FACTORS["WORLD_AVG"]
    key = country_code.strip().upper()
    return _GRID_FACTORS.get(key, _GRID_FACTORS["WORLD_AVG"])


def compute_indirect_from_electricity(
    electricity_kwh_per_t: Decimal | float | Any,
    country_code: str | None,
) -> Decimal:
    """Compute indirect embedded emissions from electricity consumption.

    Implements EU 2023/1773 Article 7(3):
        indirect_tco2e_per_t = electricity_MWh_per_t × grid_factor_tCO2e_per_MWh

    Parameters
    ----------
    electricity_kwh_per_t:
        Electricity consumed per tonne of product (kWh/t).
    country_code:
        ISO 3166-1 alpha-2 origin country.  Determines the grid factor.

    Returns
    -------
    Decimal — indirect embedded emissions (tCO2e per tonne of product).

    Notes
    -----
    The result is the *indirect* SEE component only.  Add to direct SEE
    (from fuel combustion) to obtain total SEE.
    """
    try:
        kwh_per_t = _D(str(electricity_kwh_per_t))
    except (InvalidOperation, TypeError):
        return _ZERO

    if kwh_per_t <= _ZERO:
        return _ZERO

    # Convert kWh → MWh (÷ 1000)
    mwh_per_t = kwh_per_t / _D("1000")
    factor = get_grid_factor(country_code)
    return (mwh_per_t * factor).quantize(_D("0.000001"))


def get_all_grid_factors() -> dict[str, Decimal]:
    """Return a copy of the full grid factor table.

    Useful for API endpoints that expose available country factors.
    """
    return dict(_GRID_FACTORS)


def list_cbam_relevant_countries() -> list[str]:
    """Return ISO codes of non-EU/non-EEA countries in the grid factor table.

    These are the countries that appear as CBAM goods origins and for which
    country-specific electricity factors are available.
    """
    eu_eea = {
        "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
        "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
        "NL", "PL", "PT", "RO", "SE", "SI", "SK",
        # EEA (linked ETS — excluded from CBAM)
        "IS", "LI", "NO",
        # CH (linked ETS — excluded from CBAM)
        "CH",
        # Special reference
        "WORLD_AVG",
    }
    return sorted(k for k in _GRID_FACTORS if k not in eu_eea)
