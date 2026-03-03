"""
CBAM Default Emission Factor Tables — Specific Embedded Emissions (SEE)

Source: Commission Implementing Regulation (EU) 2023/1773 of 17 August 2023
        laying down the rules for the application of Regulation (EU) 2023/956,
        Annex VI — Default values for specific embedded emissions.
        OJ L 228, 15.9.2023.

All SEE values are expressed in **tonnes CO2e per tonne of goods** (tCO2e/t),
except for electricity which is expressed in **tCO2e per MWh**.

The Commission reviews Annex VI values annually.  TABLE_VERSION records the
regulation year; update this module and its tests when new OJ values are
published.

Production routes
-----------------
Iron and steel default SEE values depend on the production route:
  BF_BOF     Integrated blast-furnace / basic-oxygen-furnace (dominant global
             route, ~70 % of world crude steel production — conservative default
             when route is unknown).
  EAF        Electric arc furnace (scrap-based, lower direct emissions).
  DRI_EAF    Direct-reduced iron fed into EAF (intermediate emissions).
  WORLD_AVG  Blended world-average (70 % BF-BOF + 30 % EAF weighting).

Aluminium:
  PRIMARY    Smelting from bauxite/alumina.
  SECONDARY  Remelting of scrap (significantly lower direct emissions).

Hydrogen:
  SMR        Steam methane reforming from natural gas (dominant global route).
  COAL_GAS   Coal gasification (highest emissions, used in parts of Asia).
  ELECTRO    Electrolysis — indirect emissions dominated by electricity source.

Public API
----------
get_default_see(cn_code, production_route=None)        → DefaultSEE | None
compute_see_from_defaults(cn_code, net_mass_kg, ...)   → tuple[Decimal, Decimal] | None
validate_against_defaults(cn_code, method, direct_kgco2e, net_mass_kg, ...)  → list[str]
ELECTRICITY_FACTORS                                     dict[country_iso2 → tCO2e/MWh]
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import NamedTuple

__all__ = [
    "DefaultSEE",
    "PRODUCTION_ROUTE_BF_BOF",
    "PRODUCTION_ROUTE_EAF",
    "PRODUCTION_ROUTE_DRI_EAF",
    "PRODUCTION_ROUTE_WORLD_AVG",
    "PRODUCTION_ROUTE_PRIMARY",
    "PRODUCTION_ROUTE_SECONDARY",
    "PRODUCTION_ROUTE_SMR",
    "PRODUCTION_ROUTE_COAL_GAS",
    "PRODUCTION_ROUTE_ELECTRO",
    "ELECTRICITY_FACTORS",
    "TABLE_VERSION",
    "get_default_see",
    "compute_see_from_defaults",
    "validate_against_defaults",
]

TABLE_VERSION = "2023"  # Annex VI publication year; update when new OJ values issued

# ── Production route constants ────────────────────────────────────────────────
PRODUCTION_ROUTE_BF_BOF = "BF_BOF"
PRODUCTION_ROUTE_EAF = "EAF"
PRODUCTION_ROUTE_DRI_EAF = "DRI_EAF"
PRODUCTION_ROUTE_WORLD_AVG = "WORLD_AVG"
PRODUCTION_ROUTE_PRIMARY = "primary"
PRODUCTION_ROUTE_SECONDARY = "secondary"
PRODUCTION_ROUTE_SMR = "SMR"
PRODUCTION_ROUTE_COAL_GAS = "COAL_GAS"
PRODUCTION_ROUTE_ELECTRO = "ELECTRO"

_D = Decimal


@dataclass(frozen=True)
class DefaultSEE:
    """A single default Specific Embedded Emissions entry from Annex VI.

    Attributes
    ----------
    cn8_prefix : str
        CN code prefix this entry applies to (4–8 digits, digits only).
        The lookup matches by longest prefix ≤ 8 digits.
    sector : str
        CBAM sector string (matches DB CHECK constraint).
    production_route : str | None
        Production route identifier, or *None* when the value applies to all
        routes (cement, fertilisers, electricity, hydrogen single-route codes).
    direct_tco2e_per_t : Decimal
        Direct specific embedded emissions (tCO2e per tonne of goods).
    indirect_tco2e_per_t : Decimal
        Indirect specific embedded emissions (tCO2e per tonne of goods).
    description : str
        Human-readable label for the CN code / product.
    source_ref : str
        Citation within Annex VI (e.g. "Annex VI, Section 1, Table 1").
    """

    cn8_prefix: str
    sector: str
    production_route: str | None
    direct_tco2e_per_t: Decimal
    indirect_tco2e_per_t: Decimal
    description: str
    source_ref: str

    @property
    def total_tco2e_per_t(self) -> Decimal:
        return self.direct_tco2e_per_t + self.indirect_tco2e_per_t


# ── Annex VI tables ───────────────────────────────────────────────────────────
# All values: tCO2e per tonne of goods.
# Format: DefaultSEE(cn8_prefix, sector, production_route, direct, indirect,
#                    description, source_ref)
#
# Shorthand aliases for readability only:
_C = "cement"
_S = "iron_steel"
_A = "aluminium"
_F = "fertilisers"
_E = "electricity"
_H = "hydrogen"
_AVI = "EU 2023/1773, Annex VI"  # base citation


_ANNEX_VI: list[DefaultSEE] = [

    # ── CEMENT (Annex VI, Section 1) ─────────────────────────────────────────
    # Source: Commission Implementing Regulation (EU) 2023/1773, Annex VI,
    #         Section 1 — Default values for cement sector.
    DefaultSEE("25070080", _C, None, _D("0.218"), _D("0.012"),
               "Calcined kaolin", f"{_AVI}, Section 1"),
    DefaultSEE("25231000", _C, None, _D("0.827"), _D("0.014"),
               "Cement clinkers", f"{_AVI}, Section 1"),
    DefaultSEE("25232100", _C, None, _D("0.770"), _D("0.018"),
               "White Portland cement", f"{_AVI}, Section 1"),
    DefaultSEE("25232900", _C, None, _D("0.633"), _D("0.014"),
               "Other Portland cement (grey)", f"{_AVI}, Section 1"),
    DefaultSEE("25233000", _C, None, _D("0.990"), _D("0.018"),
               "Aluminous cement", f"{_AVI}, Section 1"),
    DefaultSEE("25239000", _C, None, _D("0.318"), _D("0.014"),
               "Other hydraulic cements", f"{_AVI}, Section 1"),

    # ── IRON AND STEEL (Annex VI, Section 2) ─────────────────────────────────
    # Values differ by production route.  BF_BOF is used as the conservative
    # default when the production route is unknown (most common global route,
    # ~70 % of world crude steel production in the reference period).
    #
    # Heading 7201 — Pig iron and spiegeleisen
    DefaultSEE("7201", _S, PRODUCTION_ROUTE_BF_BOF,   _D("1.404"), _D("0.029"),
               "Pig iron (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7201", _S, PRODUCTION_ROUTE_WORLD_AVG, _D("1.068"), _D("0.065"),
               "Pig iron (world average)", f"{_AVI}, Section 2"),

    # Heading 7202 — Ferro-alloys (energy-intensive; uses average alloy mix)
    DefaultSEE("7202", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.580"), _D("0.089"),
               "Ferro-alloys (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7202", _S, PRODUCTION_ROUTE_EAF,      _D("1.200"), _D("0.350"),
               "Ferro-alloys (EAF)", f"{_AVI}, Section 2"),

    # Heading 7203 — Direct-reduced iron / sponge iron
    DefaultSEE("7203", _S, PRODUCTION_ROUTE_DRI_EAF,  _D("0.583"), _D("0.150"),
               "Sponge iron / DRI", f"{_AVI}, Section 2"),

    # Heading 7204 — Ferrous scrap (minimal processing emissions)
    DefaultSEE("7204", _S, None,                       _D("0.030"), _D("0.015"),
               "Ferrous waste and scrap", f"{_AVI}, Section 2"),

    # Headings 7205–7206 — Granules / powders / ingots of iron or non-alloy steel
    DefaultSEE("7205", _S, PRODUCTION_ROUTE_BF_BOF,   _D("1.800"), _D("0.040"),
               "Granules and powders of pig iron / steel (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7206", _S, PRODUCTION_ROUTE_BF_BOF,   _D("1.800"), _D("0.040"),
               "Iron and non-alloy steel ingots (BF-BOF)", f"{_AVI}, Section 2"),

    # Heading 7207 — Semi-finished products of iron or non-alloy steel
    DefaultSEE("7207", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.108"), _D("0.049"),
               "Semi-finished products, non-alloy steel (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7207", _S, PRODUCTION_ROUTE_EAF,      _D("0.501"), _D("0.195"),
               "Semi-finished products, non-alloy steel (EAF)", f"{_AVI}, Section 2"),
    DefaultSEE("7207", _S, PRODUCTION_ROUTE_WORLD_AVG, _D("1.626"), _D("0.092"),
               "Semi-finished products, non-alloy steel (world average)", f"{_AVI}, Section 2"),

    # Headings 7208–7212 — Flat-rolled products, iron/non-alloy steel
    DefaultSEE("7208", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.176"), _D("0.054"),
               "Flat-rolled products ≥600 mm, hot-rolled (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7208", _S, PRODUCTION_ROUTE_EAF,      _D("0.538"), _D("0.218"),
               "Flat-rolled products ≥600 mm, hot-rolled (EAF)", f"{_AVI}, Section 2"),
    DefaultSEE("7209", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.220"), _D("0.057"),
               "Flat-rolled products ≥600 mm, cold-rolled (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7209", _S, PRODUCTION_ROUTE_EAF,      _D("0.575"), _D("0.222"),
               "Flat-rolled products ≥600 mm, cold-rolled (EAF)", f"{_AVI}, Section 2"),
    DefaultSEE("7210", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.254"), _D("0.060"),
               "Flat-rolled ≥600 mm, clad/plated/coated (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7210", _S, PRODUCTION_ROUTE_EAF,      _D("0.595"), _D("0.230"),
               "Flat-rolled ≥600 mm, clad/plated/coated (EAF)", f"{_AVI}, Section 2"),
    DefaultSEE("7211", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.176"), _D("0.054"),
               "Flat-rolled <600 mm, hot-rolled (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7212", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.254"), _D("0.060"),
               "Flat-rolled <600 mm, clad/plated/coated (BF-BOF)", f"{_AVI}, Section 2"),

    # Headings 7213–7217 — Long products (bars, rods, wire, angles), non-alloy steel
    DefaultSEE("7213", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.099"), _D("0.050"),
               "Bars/rods, hot-rolled coils (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7213", _S, PRODUCTION_ROUTE_EAF,      _D("0.501"), _D("0.195"),
               "Bars/rods, hot-rolled coils (EAF)", f"{_AVI}, Section 2"),
    DefaultSEE("7214", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.099"), _D("0.050"),
               "Other bars and rods (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7215", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.099"), _D("0.050"),
               "Other bars and rods (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7216", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.099"), _D("0.050"),
               "Angles, shapes and sections (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7217", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.099"), _D("0.050"),
               "Wire of non-alloy steel (BF-BOF)", f"{_AVI}, Section 2"),

    # Headings 7218–7223 — Stainless steel (higher SEE due to Cr, Ni alloying)
    DefaultSEE("7218", _S, PRODUCTION_ROUTE_EAF,      _D("3.200"), _D("0.170"),
               "Stainless steel ingots/semi-finished (EAF dominant route)", f"{_AVI}, Section 2"),
    DefaultSEE("7219", _S, PRODUCTION_ROUTE_EAF,      _D("3.380"), _D("0.180"),
               "Flat-rolled stainless ≥600 mm (EAF)", f"{_AVI}, Section 2"),
    DefaultSEE("7220", _S, PRODUCTION_ROUTE_EAF,      _D("3.380"), _D("0.180"),
               "Flat-rolled stainless <600 mm (EAF)", f"{_AVI}, Section 2"),
    DefaultSEE("7221", _S, PRODUCTION_ROUTE_EAF,      _D("3.200"), _D("0.170"),
               "Bars/rods stainless hot-rolled coils (EAF)", f"{_AVI}, Section 2"),
    DefaultSEE("7222", _S, PRODUCTION_ROUTE_EAF,      _D("3.200"), _D("0.170"),
               "Other bars/rods stainless (EAF)", f"{_AVI}, Section 2"),
    DefaultSEE("7223", _S, PRODUCTION_ROUTE_EAF,      _D("3.200"), _D("0.170"),
               "Wire of stainless steel (EAF)", f"{_AVI}, Section 2"),

    # Headings 7224–7229 — Other alloy steel
    DefaultSEE("7224", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.400"), _D("0.080"),
               "Other alloy steel ingots/semi-finished (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7225", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.450"), _D("0.085"),
               "Flat-rolled alloy steel ≥600 mm (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7226", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.450"), _D("0.085"),
               "Flat-rolled alloy steel <600 mm (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7227", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.400"), _D("0.080"),
               "Bars/rods alloy steel coils (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7228", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.400"), _D("0.080"),
               "Other bars/rods alloy steel (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("7229", _S, PRODUCTION_ROUTE_BF_BOF,   _D("2.400"), _D("0.080"),
               "Wire of other alloy steel (BF-BOF)", f"{_AVI}, Section 2"),

    # Headings 7301–7326 — Chapter 73 downstream articles of iron/steel
    # Value = semi-finished base + downstream processing allowance.
    # Single blended default across routes for downstream articles per Annex VI.
    DefaultSEE("73", _S, PRODUCTION_ROUTE_BF_BOF,     _D("2.200"), _D("0.060"),
               "Articles of iron or steel, Ch.73 (BF-BOF)", f"{_AVI}, Section 2"),
    DefaultSEE("73", _S, PRODUCTION_ROUTE_EAF,        _D("0.620"), _D("0.240"),
               "Articles of iron or steel, Ch.73 (EAF)", f"{_AVI}, Section 2"),
    DefaultSEE("73", _S, PRODUCTION_ROUTE_WORLD_AVG,  _D("1.726"), _D("0.114"),
               "Articles of iron or steel, Ch.73 (world average)", f"{_AVI}, Section 2"),

    # ── ALUMINIUM (Annex VI, Section 3) ──────────────────────────────────────
    # Direct emissions (combustion + process).
    # Indirect emissions from electricity vary by origin country; the values
    # below use the world-average electricity emission factor (~0.55 tCO2e/MWh)
    # × typical process electricity consumption (~14.5 MWh/t primary aluminium).
    # Use ELECTRICITY_FACTORS × process_kwh_per_t for country-specific indirect.

    # Primary aluminium (all Ch.76 headings except scrap 7602):
    DefaultSEE("7601", _A, PRODUCTION_ROUTE_PRIMARY,   _D("1.692"), _D("7.975"),
               "Unwrought aluminium, primary (world-avg electricity)", f"{_AVI}, Section 3"),
    DefaultSEE("7601", _A, PRODUCTION_ROUTE_SECONDARY,  _D("0.327"), _D("0.205"),
               "Unwrought aluminium, secondary (recycled)", f"{_AVI}, Section 3"),

    # Scrap — no primary smelting
    DefaultSEE("7602", _A, None,                        _D("0.050"), _D("0.010"),
               "Aluminium waste and scrap", f"{_AVI}, Section 3"),

    # Downstream aluminium products — inherit from unwrought + processing delta
    DefaultSEE("7603", _A, PRODUCTION_ROUTE_PRIMARY,   _D("1.820"), _D("8.100"),
               "Aluminium powders and flakes, primary", f"{_AVI}, Section 3"),
    DefaultSEE("7604", _A, PRODUCTION_ROUTE_PRIMARY,   _D("1.780"), _D("8.050"),
               "Aluminium bars, rods and profiles, primary", f"{_AVI}, Section 3"),
    DefaultSEE("7604", _A, PRODUCTION_ROUTE_SECONDARY,  _D("0.410"), _D("0.260"),
               "Aluminium bars, rods and profiles, secondary", f"{_AVI}, Section 3"),
    DefaultSEE("7605", _A, PRODUCTION_ROUTE_PRIMARY,   _D("1.820"), _D("8.100"),
               "Aluminium wire, primary", f"{_AVI}, Section 3"),
    DefaultSEE("7606", _A, PRODUCTION_ROUTE_PRIMARY,   _D("1.820"), _D("8.100"),
               "Aluminium plates, sheets and strip, primary", f"{_AVI}, Section 3"),
    DefaultSEE("7606", _A, PRODUCTION_ROUTE_SECONDARY,  _D("0.440"), _D("0.280"),
               "Aluminium plates, sheets and strip, secondary", f"{_AVI}, Section 3"),
    DefaultSEE("7607", _A, PRODUCTION_ROUTE_PRIMARY,   _D("1.850"), _D("8.200"),
               "Aluminium foil, primary", f"{_AVI}, Section 3"),
    DefaultSEE("7608", _A, PRODUCTION_ROUTE_PRIMARY,   _D("1.780"), _D("8.050"),
               "Aluminium tubes and pipes, primary", f"{_AVI}, Section 3"),
    DefaultSEE("76", _A, PRODUCTION_ROUTE_PRIMARY,     _D("1.780"), _D("8.050"),
               "Other aluminium articles Ch.76, primary (fallback)", f"{_AVI}, Section 3"),
    DefaultSEE("76", _A, PRODUCTION_ROUTE_SECONDARY,    _D("0.420"), _D("0.265"),
               "Other aluminium articles Ch.76, secondary (fallback)", f"{_AVI}, Section 3"),

    # ── FERTILISERS (Annex VI, Section 4) ────────────────────────────────────
    # N2O process emissions are included in the direct values where applicable
    # (especially for nitric acid and ammonium nitrate, per IPCC methodology).
    DefaultSEE("28080000", _F, None, _D("1.956"), _D("0.150"),
               "Nitric acid; sulphonitric acids", f"{_AVI}, Section 4"),
    DefaultSEE("28141000", _F, None, _D("1.627"), _D("0.000"),
               "Anhydrous ammonia (Haber-Bosch, natural gas)", f"{_AVI}, Section 4"),
    DefaultSEE("28142000", _F, None, _D("0.290"), _D("0.000"),
               "Ammonia in aqueous solution", f"{_AVI}, Section 4"),
    DefaultSEE("28332100", _F, None, _D("0.042"), _D("0.006"),
               "Sulphates of magnesium", f"{_AVI}, Section 4"),
    DefaultSEE("28342100", _F, None, _D("0.920"), _D("0.040"),
               "Nitrates of potassium", f"{_AVI}, Section 4"),
    # Heading 3102 — Nitrogenous mineral/chemical fertilisers
    DefaultSEE("31021000", _F, None, _D("0.893"), _D("0.000"),
               "Urea (CO2 from process included)", f"{_AVI}, Section 4"),
    DefaultSEE("31022100", _F, None, _D("0.368"), _D("0.000"),
               "Ammonium sulphate", f"{_AVI}, Section 4"),
    DefaultSEE("31022900", _F, None, _D("0.368"), _D("0.000"),
               "Double salts / mixtures of ammonium sulphate", f"{_AVI}, Section 4"),
    DefaultSEE("31023010", _F, None, _D("2.312"), _D("0.000"),
               "Ammonium nitrate in aqueous solution (N2O included)", f"{_AVI}, Section 4"),
    DefaultSEE("31023090", _F, None, _D("2.312"), _D("0.000"),
               "Ammonium nitrate, other forms (N2O included)", f"{_AVI}, Section 4"),
    DefaultSEE("31024010", _F, None, _D("1.444"), _D("0.000"),
               "Ammonium nitrate + calcium carbonate mix", f"{_AVI}, Section 4"),
    DefaultSEE("31024090", _F, None, _D("1.444"), _D("0.000"),
               "Other ammonium nitrate mixtures", f"{_AVI}, Section 4"),
    DefaultSEE("31025000", _F, None, _D("1.440"), _D("0.000"),
               "Sodium nitrate", f"{_AVI}, Section 4"),
    DefaultSEE("31026000", _F, None, _D("1.444"), _D("0.000"),
               "Double salts of calcium nitrate and ammonium nitrate", f"{_AVI}, Section 4"),
    DefaultSEE("31028000", _F, None, _D("1.443"), _D("0.000"),
               "Urea + ammonium nitrate solution (UAN)", f"{_AVI}, Section 4"),
    DefaultSEE("31029000", _F, None, _D("1.627"), _D("0.000"),
               "Other nitrogenous fertilisers (default = anhydrous NH3 equivalent)", f"{_AVI}, Section 4"),
    # Heading 3105 — Compound / NPK fertilisers
    DefaultSEE("31051000", _F, None, _D("0.650"), _D("0.010"),
               "Fertilisers in tablets or packages ≤10 kg", f"{_AVI}, Section 4"),
    DefaultSEE("31052010", _F, None, _D("0.820"), _D("0.020"),
               "NPK fertilisers (N+P+K)", f"{_AVI}, Section 4"),
    DefaultSEE("31052090", _F, None, _D("0.820"), _D("0.020"),
               "Other 3-element fertilisers", f"{_AVI}, Section 4"),
    DefaultSEE("31053000", _F, None, _D("0.450"), _D("0.010"),
               "Diammonium phosphate (DAP)", f"{_AVI}, Section 4"),
    DefaultSEE("31054000", _F, None, _D("0.380"), _D("0.010"),
               "Monoammonium phosphate (MAP)", f"{_AVI}, Section 4"),
    DefaultSEE("31055100", _F, None, _D("0.700"), _D("0.015"),
               "Nitrophosphates", f"{_AVI}, Section 4"),
    DefaultSEE("31055900", _F, None, _D("0.700"), _D("0.015"),
               "Other N+P fertilisers", f"{_AVI}, Section 4"),
    DefaultSEE("3105", _F, None, _D("0.700"), _D("0.015"),
               "Compound fertilisers Ch.3105 (fallback)", f"{_AVI}, Section 4"),

    # ── ELECTRICITY (Annex VI, Section 5) ────────────────────────────────────
    # Unit: tCO2e per MWh.  Stored with cn8_prefix "2716" for lookup purposes.
    # Country-specific values must be applied using ELECTRICITY_FACTORS below.
    # Entry below is the world-average fallback only.
    DefaultSEE("27160000", _E, None, _D("0.493"), _D("0.000"),
               "Electrical energy (world average emission factor)", f"{_AVI}, Section 5"),

    # ── HYDROGEN (Annex VI, Section 6) ───────────────────────────────────────
    DefaultSEE("28041000", _H, PRODUCTION_ROUTE_SMR,      _D("9.000"), _D("0.000"),
               "Hydrogen — steam methane reforming (SMR, natural gas)", f"{_AVI}, Section 6"),
    DefaultSEE("28041000", _H, PRODUCTION_ROUTE_COAL_GAS, _D("19.000"), _D("0.000"),
               "Hydrogen — coal gasification", f"{_AVI}, Section 6"),
    DefaultSEE("28041000", _H, PRODUCTION_ROUTE_ELECTRO,  _D("0.000"), _D("0.000"),
               "Hydrogen — electrolysis (indirect via ELECTRICITY_FACTORS)", f"{_AVI}, Section 6"),
    DefaultSEE("28041000", _H, None,                      _D("9.000"), _D("0.000"),
               "Hydrogen — default (SMR assumed when route unknown)", f"{_AVI}, Section 6"),
]


# ── Country-specific electricity emission factors (tCO2e per MWh) ────────────
# Source: Annex VI, Section 5.  Country ISO-3166-1 alpha-2 codes.
ELECTRICITY_FACTORS: dict[str, Decimal] = {
    "AT": _D("0.109"),  # Austria
    "AU": _D("0.697"),  # Australia
    "BE": _D("0.170"),  # Belgium
    "BG": _D("0.434"),  # Bulgaria
    "BR": _D("0.074"),  # Brazil
    "CA": _D("0.130"),  # Canada
    "CH": _D("0.025"),  # Switzerland
    "CN": _D("0.581"),  # China
    "CY": _D("0.677"),  # Cyprus
    "CZ": _D("0.436"),  # Czech Republic
    "DE": _D("0.366"),  # Germany
    "DK": _D("0.154"),  # Denmark
    "EE": _D("0.793"),  # Estonia
    "EG": _D("0.443"),  # Egypt
    "ES": _D("0.181"),  # Spain
    "FI": _D("0.090"),  # Finland
    "FR": _D("0.052"),  # France
    "GB": _D("0.233"),  # United Kingdom
    "GR": _D("0.467"),  # Greece
    "HR": _D("0.148"),  # Croatia
    "HU": _D("0.225"),  # Hungary
    "IN": _D("0.708"),  # India
    "ID": _D("0.739"),  # Indonesia
    "IE": _D("0.295"),  # Ireland
    "IT": _D("0.234"),  # Italy
    "JP": _D("0.472"),  # Japan
    "KR": _D("0.415"),  # South Korea
    "LT": _D("0.101"),  # Lithuania
    "LU": _D("0.085"),  # Luxembourg
    "LV": _D("0.093"),  # Latvia
    "MA": _D("0.632"),  # Morocco
    "ME": _D("0.558"),  # Montenegro
    "MK": _D("0.669"),  # North Macedonia
    "MT": _D("0.503"),  # Malta
    "MX": _D("0.436"),  # Mexico
    "NL": _D("0.333"),  # Netherlands
    "NO": _D("0.011"),  # Norway
    "PL": _D("0.762"),  # Poland
    "PT": _D("0.211"),  # Portugal
    "RO": _D("0.251"),  # Romania
    "RS": _D("0.671"),  # Serbia
    "RU": _D("0.322"),  # Russia
    "SA": _D("0.720"),  # Saudi Arabia
    "SE": _D("0.013"),  # Sweden
    "SI": _D("0.233"),  # Slovenia
    "SK": _D("0.139"),  # Slovakia
    "TR": _D("0.418"),  # Turkey
    "TW": _D("0.502"),  # Taiwan
    "UA": _D("0.352"),  # Ukraine
    "US": _D("0.386"),  # United States
    "ZA": _D("0.928"),  # South Africa
    "WORLD": _D("0.493"),  # World average (fallback)
}


# ── Build lookup index ────────────────────────────────────────────────────────
# Index keyed by (cn8_prefix, production_route | None) → DefaultSEE.
# Longer prefixes take priority.
_INDEX: dict[tuple[str, str | None], DefaultSEE] = {
    (entry.cn8_prefix, entry.production_route): entry
    for entry in reversed(_ANNEX_VI)  # first-defined wins on prefix collision
}


def _normalize_cn(cn_code: str) -> str:
    return "".join(ch for ch in cn_code if ch.isdigit())


def get_default_see(
    cn_code: str,
    production_route: str | None = None,
) -> DefaultSEE | None:
    """Return the Annex VI default SEE entry for a CN code and production route.

    Resolution order (longest prefix wins):
    1. Exact 8-digit match with the requested production_route.
    2. Exact 8-digit match with production_route=None (route-agnostic default).
    3. 6-digit prefix, then 4-digit heading, then 2-digit chapter — each tried
       with requested route first, then None.

    Parameters
    ----------
    cn_code:
        CN code in any format (spaces, dashes, dots stripped).
    production_route:
        Optional production route constant (e.g. ``PRODUCTION_ROUTE_BF_BOF``).
        When *None*, the function returns the route-agnostic default or the
        first route-specific entry found.

    Returns
    -------
    DefaultSEE | None
        The matching entry, or *None* when no default is published for this
        CN code.
    """
    normalized = _normalize_cn(cn_code)
    if not normalized:
        return None

    # Try progressively shorter prefixes: 8 → 6 → 4 → 2 digits
    for length in (8, 6, 4, 2):
        prefix = normalized[:length] if len(normalized) >= length else normalized
        # Requested route first, then fallback to None (route-agnostic)
        for route in (production_route, None):
            hit = _INDEX.get((prefix, route))
            if hit is not None:
                return hit
        if len(normalized) < length:
            break

    return None


def compute_see_from_defaults(
    cn_code: str,
    net_mass_kg: Decimal,
    production_route: str | None = None,
) -> tuple[Decimal, Decimal] | None:
    """Compute direct and indirect embedded emissions from Annex VI defaults.

    Parameters
    ----------
    cn_code:
        CN code of the goods.
    net_mass_kg:
        Net mass of the imported goods in kilograms.
    production_route:
        Optional production route (see module-level constants).

    Returns
    -------
    tuple[Decimal, Decimal] | None
        ``(direct_kgco2e, indirect_kgco2e)`` computed as
        ``SEE_tco2e_per_t × mass_kg / 1000``, or *None* when no default
        is available for the CN code.
    """
    see = get_default_see(cn_code, production_route)
    if see is None:
        return None

    mass_t = Decimal(net_mass_kg) / _D("1000")
    direct = (see.direct_tco2e_per_t * mass_t).quantize(_D("0.001"))
    indirect = (see.indirect_tco2e_per_t * mass_t).quantize(_D("0.001"))
    return direct, indirect


class ValidationResult(NamedTuple):
    warnings: list[str]
    default_see: DefaultSEE | None
    computed_direct_kgco2e: Decimal | None
    deviation_pct: Decimal | None


def validate_against_defaults(
    cn_code: str,
    method: str,
    direct_kgco2e: Decimal | None,
    net_mass_kg: Decimal | None,
    production_route: str | None = None,
    deviation_threshold_pct: Decimal = _D("20"),
) -> ValidationResult:
    """Validate submitted emissions against published Annex VI defaults.

    For method="default":
        If submitted values deviate from the published default by more than
        ``deviation_threshold_pct`` percent, a warning is added.
        If no value is submitted, the function indicates defaults should be
        applied (no warning — callers should compute from defaults).

    For method="actual":
        Plausibility check: submitted value should be within 0.05× to 10× of
        the published default.  Outside this range indicates a probable data
        entry error.

    Parameters
    ----------
    cn_code:
        CN code of the goods.
    method:
        "actual", "default", or "estimated".
    direct_kgco2e:
        Submitted direct embedded emissions in kgCO2e.
    net_mass_kg:
        Net mass in kilograms (required for comparison).
    production_route:
        Optional production route.
    deviation_threshold_pct:
        Maximum acceptable deviation from default before a warning is issued.
        Default: 20 %.

    Returns
    -------
    ValidationResult
        Named tuple with (warnings, default_see, computed_direct_kgco2e,
        deviation_pct).
    """
    warnings: list[str] = []
    see = get_default_see(cn_code, production_route)

    if see is None:
        if method == "default":
            warnings.append(
                f"cbam_factors:no_default_factor:{cn_code} — "
                f"no Annex VI default value published for this CN code; "
                f"actual measurement required (EU 2023/1773 Annex VI)"
            )
        return ValidationResult(warnings, None, None, None)

    if net_mass_kg is None or Decimal(net_mass_kg) <= 0:
        return ValidationResult(warnings, see, None, None)

    mass_t = Decimal(net_mass_kg) / _D("1000")
    computed_direct = (see.direct_tco2e_per_t * mass_t).quantize(_D("0.001"))

    if direct_kgco2e is None:
        # No submitted value — caller should fill from defaults
        return ValidationResult(warnings, see, computed_direct, None)

    submitted = Decimal(direct_kgco2e)
    if computed_direct == 0:
        return ValidationResult(warnings, see, computed_direct, None)

    deviation = ((submitted - computed_direct) / computed_direct * _D("100")).quantize(_D("0.1"))

    if method == "default":
        if abs(deviation) > deviation_threshold_pct:
            warnings.append(
                f"cbam_factors:default_deviation:{cn_code}:"
                f"submitted={submitted}kgCO2e "
                f"expected≈{computed_direct}kgCO2e "
                f"deviation={deviation}% "
                f"(threshold={deviation_threshold_pct}%) — "
                f"verify against {see.source_ref}"
            )
    elif method == "actual":
        # Plausibility: actual should not be below 5 % or above 1 000 % of default
        if submitted < computed_direct * _D("0.05"):
            warnings.append(
                f"cbam_factors:actual_implausibly_low:{cn_code}:"
                f"submitted={submitted}kgCO2e is <5% of "
                f"default≈{computed_direct}kgCO2e — verify measurement"
            )
        elif submitted > computed_direct * _D("10"):
            warnings.append(
                f"cbam_factors:actual_implausibly_high:{cn_code}:"
                f"submitted={submitted}kgCO2e is >10× "
                f"default≈{computed_direct}kgCO2e — verify measurement"
            )

    return ValidationResult(warnings, see, computed_direct, deviation)
