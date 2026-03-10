"""
CBAM Default Emission Factor Tables — Specific Embedded Emissions (SEE)

Source: Commission Implementing Regulation (EU) 2023/1773 of 17 August 2023
        laying down the rules for the application of Regulation (EU) 2023/956.
        OJ L 228, 15.9.2023.

Operative default values: "Default Values for the Transitional Period of the
        CBAM between 1 October 2023 and 31 December 2025", European Commission
        DG TAXUD, published 22 December 2023 under Art. 4(3) of EU 2023/1773.
        These are the world-average values declarants must use when the actual
        embedded emissions are unknown.  OJ L 228 sets the framework; the
        Art. 4(3) table contains the operative numbers.

All SEE values are expressed in **tonnes CO2e per tonne of goods** (tCO2e/t),
except for electricity which is expressed in **tCO2e per MWh**.

The Commission reviews Annex VI values annually.  TABLE_VERSION records the
regulation year; update this module and its tests when new values are published.

Official default values (production_route=None)
------------------------------------------------
All production_route=None entries reflect the published world-average defaults
from the Art. 4(3) DG TAXUD table.  These are weighted world averages based on
JRC 2023 methodology covering major producing countries.

Route-specific entries (engineering estimates)
----------------------------------------------
Entries tagged BF_BOF, EAF, DRI_EAF, PRIMARY, SECONDARY, SMR, COAL_GAS or
ELECTRO are **engineering estimates** for use when the production route is
known and reported under method="actual".  They are NOT published official
default values.  The official table provides single world-average figures only.

Iron and steel:
  BF_BOF     Integrated blast-furnace / basic-oxygen-furnace.
  EAF        Electric arc furnace (scrap-based, lower direct emissions).
  DRI_EAF    Direct-reduced iron fed into EAF (intermediate emissions).

Aluminium:
  PRIMARY    Smelting from bauxite/alumina.
  SECONDARY  Remelting of scrap (significantly lower direct emissions).

Hydrogen:
  SMR        Steam methane reforming from natural gas.
  COAL_GAS   Coal gasification (highest emissions).
  ELECTRO    Electrolysis — indirect emissions dominated by electricity source.

Public API
----------
get_default_see(cn_code, production_route=None)        → DefaultSEE | None
compute_see_from_defaults(cn_code, net_mass_kg, ...)   → tuple[Decimal, Decimal] | None
validate_against_defaults(cn_code, method, direct_kgco2e, net_mass_kg, ...)  → list[str]
ELECTRICITY_FACTORS                                     dict[country_iso2 → tCO2e/MWh]
"""

from __future__ import annotations

import hashlib
import json
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
    "FACTOR_METADATA",
    "get_default_see",
    "compute_see_from_defaults",
    "validate_against_defaults",
]

TABLE_VERSION = "2023"  # Transitional period default values (Oct 2023 – Dec 2025)

# Structured provenance metadata — included in every calculation snapshot so that
# a third-party auditor can verify exactly which table was used.
FACTOR_METADATA = {
    "table_version": TABLE_VERSION,
    "regulation": "Commission Implementing Regulation (EU) 2023/1773",
    "annex": "Annex VI — Default values for specific embedded emissions",
    "oj_reference": "OJ L 228, 15.9.2023",
    "operative_document": (
        "Default Values for the Transitional Period of the CBAM "
        "(1 Oct 2023 – 31 Dec 2025), EC DG TAXUD, 22 Dec 2023, Art. 4(3)"
    ),
    "effective_date": "2023-10-01",
    "review_cadence": "annual",
    "unit_see": "tCO2e per tonne of goods (except electricity: tCO2e/MWh)",
    "note_route_entries": (
        "Entries with a production_route tag other than None are engineering "
        "estimates for actual-measurement reporting and are NOT official defaults."
    ),
}

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
        CN code prefix this entry applies to (2–8 digits, digits only).
        The lookup matches by longest prefix ≤ 8 digits.
    sector : str
        CBAM sector string (matches DB CHECK constraint).
    production_route : str | None
        Production route identifier, or *None* for the official world-average
        default (the value declarants must use when route is unknown).
    direct_tco2e_per_t : Decimal
        Direct specific embedded emissions (tCO2e per tonne of goods).
    indirect_tco2e_per_t : Decimal
        Indirect specific embedded emissions (tCO2e per tonne of goods).
    description : str
        Human-readable label for the CN code / product.
    source_ref : str
        Citation within the operative document.
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
# All values: tCO2e per tonne of goods (tCO2e/MWh for electricity).
# production_route=None  →  official world-average default (Art. 4(3) table).
# production_route=<tag> →  engineering estimate for actual-measurement use.
#
# Format: DefaultSEE(cn8_prefix, sector, production_route, direct, indirect,
#                    description, source_ref)
#
_C = "cement"
_S = "iron_steel"
_A = "aluminium"
_F = "fertilisers"
_E = "electricity"
_H = "hydrogen"
_AVI = "EU 2023/1773 Art.4(3) Default Values, DG TAXUD Dec 2023"


_ANNEX_VI: list[DefaultSEE] = [

    # ── CEMENT (Table 1) ──────────────────────────────────────────────────────
    # Official world-average default values.  All values tCO2e/t.
    DefaultSEE("25070080", _C, None, _D("0.230"), _D("0.080"),
               "Calcined kaolin", _AVI),
    DefaultSEE("25231000", _C, None, _D("0.830"), _D("0.040"),
               "Cement clinkers", _AVI),
    DefaultSEE("25232100", _C, None, _D("1.160"), _D("0.100"),
               "White Portland cement", _AVI),
    DefaultSEE("25232900", _C, None, _D("0.810"), _D("0.060"),
               "Other Portland cement (grey)", _AVI),
    DefaultSEE("25233000", _C, None, _D("1.750"), _D("0.150"),
               "Aluminous cement", _AVI),
    DefaultSEE("25239000", _C, None, _D("0.590"), _D("0.040"),
               "Other hydraulic cements", _AVI),

    # ── IRON AND STEEL (Table 2) ──────────────────────────────────────────────
    # production_route=None: official world-average default per Art. 4(3) table.
    # Route-tagged entries: engineering estimates for actual-measurement use only.
    #
    # Heading 7201 — Pig iron and spiegeleisen
    DefaultSEE("7201", _S, None,                     _D("1.900"), _D("0.170"),
               "Pig iron — world average (official default)", _AVI),
    DefaultSEE("7201", _S, PRODUCTION_ROUTE_BF_BOF,  _D("2.200"), _D("0.040"),
               "Pig iron (BF-BOF, engineering estimate)", _AVI),
    DefaultSEE("7201", _S, PRODUCTION_ROUTE_EAF,     _D("0.600"), _D("0.450"),
               "Pig iron (EAF, engineering estimate)", _AVI),

    # Heading 7202 — Ferro-alloys
    DefaultSEE("7202", _S, None,                     _D("2.100"), _D("0.300"),
               "Ferro-alloys — world average (official default)", _AVI),
    DefaultSEE("7202", _S, PRODUCTION_ROUTE_BF_BOF,  _D("2.580"), _D("0.089"),
               "Ferro-alloys (BF-BOF, engineering estimate)", _AVI),
    DefaultSEE("7202", _S, PRODUCTION_ROUTE_EAF,     _D("1.200"), _D("0.700"),
               "Ferro-alloys (EAF, engineering estimate)", _AVI),

    # Heading 7203 — Direct-reduced iron / sponge iron
    DefaultSEE("7203", _S, None,                        _D("1.200"), _D("0.200"),
               "Sponge iron / DRI — world average (official default)", _AVI),
    DefaultSEE("7203", _S, PRODUCTION_ROUTE_DRI_EAF,   _D("0.900"), _D("0.200"),
               "Sponge iron / DRI — DRI-EAF route (engineering estimate)", _AVI),

    # Heading 7204 — Ferrous scrap (minimal processing)
    DefaultSEE("7204", _S, None,                     _D("0.030"), _D("0.015"),
               "Ferrous waste and scrap", _AVI),

    # Headings 7205–7206 — Granules / powders / ingots
    DefaultSEE("7205", _S, None,                     _D("1.900"), _D("0.170"),
               "Granules and powders of pig iron / steel — world average", _AVI),
    DefaultSEE("720610", _S, None,                   _D("2.520"), _D("0.230"),
               "Iron/non-alloy steel ingots (7206 10 00) — world average", _AVI),
    DefaultSEE("720690", _S, None,                   _D("1.970"), _D("0.230"),
               "Other iron/non-alloy steel ingots (7206 90 00) — world average", _AVI),
    DefaultSEE("7206", _S, None,                     _D("2.100"), _D("0.230"),
               "Iron and non-alloy steel ingots — world average (fallback)", _AVI),

    # Heading 7207 — Semi-finished products of iron or non-alloy steel
    DefaultSEE("7207", _S, None,                        _D("1.890"), _D("0.320"),
               "Semi-finished, non-alloy steel, rolled/cast — world average", _AVI),
    DefaultSEE("7207", _S, PRODUCTION_ROUTE_BF_BOF,    _D("2.440"), _D("0.090"),
               "Semi-finished, non-alloy steel (BF-BOF, engineering estimate)", _AVI),
    DefaultSEE("7207", _S, PRODUCTION_ROUTE_EAF,       _D("0.610"), _D("0.550"),
               "Semi-finished, non-alloy steel (EAF, engineering estimate)", _AVI),
    DefaultSEE("7207", _S, PRODUCTION_ROUTE_DRI_EAF,   _D("1.050"), _D("0.300"),
               "Semi-finished, non-alloy steel (DRI-EAF, engineering estimate)", _AVI),

    # Headings 7208–7212 — Flat-rolled products, iron/non-alloy steel
    DefaultSEE("7208", _S, None,                     _D("2.010"), _D("0.270"),
               "Flat-rolled ≥600 mm, hot-rolled — world average", _AVI),
    DefaultSEE("7208", _S, PRODUCTION_ROUTE_BF_BOF,  _D("2.600"), _D("0.070"),
               "Flat-rolled ≥600 mm, hot-rolled (BF-BOF, engineering estimate)", _AVI),
    DefaultSEE("7208", _S, PRODUCTION_ROUTE_EAF,     _D("0.650"), _D("0.600"),
               "Flat-rolled ≥600 mm, hot-rolled (EAF, engineering estimate)", _AVI),

    DefaultSEE("7209", _S, None,                     _D("2.030"), _D("0.360"),
               "Flat-rolled ≥600 mm, cold-rolled — world average", _AVI),
    DefaultSEE("7209", _S, PRODUCTION_ROUTE_BF_BOF,  _D("2.650"), _D("0.075"),
               "Flat-rolled ≥600 mm, cold-rolled (BF-BOF, engineering estimate)", _AVI),
    DefaultSEE("7209", _S, PRODUCTION_ROUTE_EAF,     _D("0.660"), _D("0.650"),
               "Flat-rolled ≥600 mm, cold-rolled (EAF, engineering estimate)", _AVI),

    DefaultSEE("7210", _S, None,                     _D("1.970"), _D("0.390"),
               "Flat-rolled ≥600 mm, clad/plated/coated — world average", _AVI),
    DefaultSEE("7210", _S, PRODUCTION_ROUTE_BF_BOF,  _D("2.600"), _D("0.080"),
               "Flat-rolled ≥600 mm, clad/plated (BF-BOF, engineering estimate)", _AVI),
    DefaultSEE("7210", _S, PRODUCTION_ROUTE_EAF,     _D("0.650"), _D("0.680"),
               "Flat-rolled ≥600 mm, clad/plated (EAF, engineering estimate)", _AVI),

    DefaultSEE("7211", _S, None,                     _D("2.010"), _D("0.270"),
               "Flat-rolled <600 mm, hot-rolled — world average", _AVI),
    DefaultSEE("7212", _S, None,                     _D("1.970"), _D("0.390"),
               "Flat-rolled <600 mm, clad/plated/coated — world average", _AVI),

    # Headings 7213–7217 — Long products (bars, rods, wire, angles), non-alloy steel
    DefaultSEE("7213", _S, None,                     _D("1.890"), _D("0.320"),
               "Bars/rods, hot-rolled coils — world average", _AVI),
    DefaultSEE("7213", _S, PRODUCTION_ROUTE_BF_BOF,  _D("2.440"), _D("0.080"),
               "Bars/rods, hot-rolled coils (BF-BOF, engineering estimate)", _AVI),
    DefaultSEE("7213", _S, PRODUCTION_ROUTE_EAF,     _D("0.610"), _D("0.550"),
               "Bars/rods, hot-rolled coils (EAF, engineering estimate)", _AVI),

    DefaultSEE("721410", _S, None,                   _D("2.650"), _D("0.620"),
               "Other bars and rods, forged (7214 10 00) — world average", _AVI),
    DefaultSEE("7214", _S, None,                     _D("1.890"), _D("0.320"),
               "Other bars and rods, rolled — world average", _AVI),
    DefaultSEE("7214", _S, PRODUCTION_ROUTE_BF_BOF,  _D("2.440"), _D("0.080"),
               "Other bars and rods (BF-BOF, engineering estimate)", _AVI),
    DefaultSEE("7214", _S, PRODUCTION_ROUTE_EAF,     _D("0.610"), _D("0.550"),
               "Other bars and rods (EAF, engineering estimate)", _AVI),

    DefaultSEE("7215", _S, None,                     _D("1.890"), _D("0.320"),
               "Other bars and rods, non-alloy steel — world average", _AVI),
    DefaultSEE("7215", _S, PRODUCTION_ROUTE_BF_BOF,  _D("2.440"), _D("0.080"),
               "Other bars and rods, non-alloy (BF-BOF, engineering estimate)", _AVI),
    DefaultSEE("7215", _S, PRODUCTION_ROUTE_EAF,     _D("0.610"), _D("0.550"),
               "Other bars and rods, non-alloy (EAF, engineering estimate)", _AVI),

    DefaultSEE("7216", _S, None,                     _D("1.890"), _D("0.320"),
               "Angles, shapes and sections — world average", _AVI),
    DefaultSEE("7216", _S, PRODUCTION_ROUTE_BF_BOF,  _D("2.440"), _D("0.080"),
               "Angles, shapes and sections (BF-BOF, engineering estimate)", _AVI),
    DefaultSEE("7216", _S, PRODUCTION_ROUTE_EAF,     _D("0.610"), _D("0.550"),
               "Angles, shapes and sections (EAF, engineering estimate)", _AVI),

    DefaultSEE("721710", _S, None,                   _D("1.880"), _D("0.490"),
               "Wire, non-alloy steel, unplated/uncoated (7217 10) — world average", _AVI),
    DefaultSEE("721730", _S, None,                   _D("1.950"), _D("0.510"),
               "Wire, non-alloy steel, plated with other base metals (7217 30) — world average",
               _AVI),
    DefaultSEE("7217", _S, None,                     _D("1.900"), _D("0.490"),
               "Wire of non-alloy steel — world average (fallback)", _AVI),

    # Headings 7218–7223 — Stainless steel (EAF dominant route)
    # Official table provides separate hot-rolled / cold-rolled / forged sub-entries.
    DefaultSEE("721810", _S, None,                   _D("2.510"), _D("2.100"),
               "Stainless steel ingots, forged (7218 10 00) — world average", _AVI),
    DefaultSEE("7218", _S, None,                     _D("2.180"), _D("1.900"),
               "Stainless steel ingots/semi-finished, rolled — world average", _AVI),
    DefaultSEE("7218", _S, PRODUCTION_ROUTE_EAF,     _D("2.180"), _D("1.900"),
               "Stainless steel ingots/semi-finished, rolled (EAF, official route)", _AVI),

    DefaultSEE("721911", _S, None,                   _D("2.210"), _D("1.990"),
               "Flat-rolled stainless ≥600 mm, cold-rolled (7219 1x) — world average", _AVI),
    DefaultSEE("7219", _S, None,                     _D("2.180"), _D("1.900"),
               "Flat-rolled stainless ≥600 mm, hot-rolled — world average", _AVI),
    DefaultSEE("7219", _S, PRODUCTION_ROUTE_EAF,     _D("2.180"), _D("1.900"),
               "Flat-rolled stainless ≥600 mm (EAF, official route)", _AVI),

    DefaultSEE("7220", _S, None,                     _D("2.190"), _D("1.940"),
               "Flat-rolled stainless <600 mm — world average", _AVI),

    DefaultSEE("7221", _S, None,                     _D("2.140"), _D("2.170"),
               "Bars/rods stainless steel, hot-rolled coils — world average", _AVI),
    DefaultSEE("7221", _S, PRODUCTION_ROUTE_EAF,     _D("2.140"), _D("2.170"),
               "Bars/rods stainless (EAF, official route)", _AVI),

    DefaultSEE("7222", _S, None,                     _D("2.510"), _D("2.100"),
               "Other bars/rods of stainless steel — world average", _AVI),

    DefaultSEE("7223", _S, None,                     _D("2.130"), _D("2.360"),
               "Wire of stainless steel — world average", _AVI),

    # Headings 7224–7229 — Other alloy steel
    DefaultSEE("7224", _S, None,                     _D("2.200"), _D("0.400"),
               "Other alloy steel ingots/semi-finished — world average", _AVI),
    DefaultSEE("7225", _S, None,                     _D("2.200"), _D("0.400"),
               "Flat-rolled alloy steel ≥600 mm — world average", _AVI),
    DefaultSEE("7226", _S, None,                     _D("2.200"), _D("0.400"),
               "Flat-rolled alloy steel <600 mm — world average", _AVI),
    DefaultSEE("7227", _S, None,                     _D("2.200"), _D("0.400"),
               "Bars/rods of other alloy steel, in coils — world average", _AVI),
    DefaultSEE("7228", _S, None,                     _D("2.200"), _D("0.400"),
               "Other bars/rods of other alloy steel — world average", _AVI),
    DefaultSEE("7229", _S, None,                     _D("2.200"), _D("0.400"),
               "Wire of other alloy steel — world average", _AVI),

    # ── CHAPTER 73 — Downstream articles of iron or steel ─────────────────────
    # Per-heading official default values from Art. 4(3) table.
    # Note: CN 7313 (barbed wire) is excluded from CBAM scope per EU 2023/956 Annex I.
    DefaultSEE("7301", _S, None,                     _D("2.030"), _D("0.360"),
               "Sheet piling; welded angles, shapes and sections", _AVI),
    DefaultSEE("7302", _S, None,                     _D("1.930"), _D("0.290"),
               "Railway or tramway track construction material", _AVI),
    DefaultSEE("7303", _S, None,                     _D("2.210"), _D("0.350"),
               "Tubes, pipes and hollow profiles of cast iron", _AVI),
    DefaultSEE("7304", _S, None,                     _D("1.860"), _D("0.350"),
               "Tubes, pipes and hollow profiles, seamless (iron or steel)", _AVI),
    DefaultSEE("7305", _S, None,                     _D("2.030"), _D("0.360"),
               "Other tubes and pipes, welded, OD >406.4 mm", _AVI),
    DefaultSEE("7306", _S, None,                     _D("1.990"), _D("0.370"),
               "Other tubes, pipes and hollow profiles, welded", _AVI),
    DefaultSEE("7307", _S, None,                     _D("2.540"), _D("0.570"),
               "Tube or pipe fittings (cast iron)", _AVI),
    DefaultSEE("7308", _S, None,                     _D("2.460"), _D("2.550"),
               "Structures and parts (bridges, towers, columns — fabricated steel)", _AVI),
    DefaultSEE("7309", _S, None,                     _D("1.970"), _D("0.390"),
               "Reservoirs, tanks, vats and similar containers, >300 L", _AVI),
    DefaultSEE("7310", _S, None,                     _D("1.970"), _D("0.390"),
               "Tanks, casks, drums, cans and similar containers, ≤300 L", _AVI),
    DefaultSEE("7311", _S, None,                     _D("1.890"), _D("0.320"),
               "Containers for compressed or liquefied gas, of iron or steel", _AVI),
    DefaultSEE("7312", _S, None,                     _D("1.950"), _D("0.510"),
               "Stranded wire, ropes, cables, plaited bands and slings", _AVI),
    DefaultSEE("7314", _S, None,                     _D("1.950"), _D("0.510"),
               "Cloth, grill, netting and fencing of iron or steel wire", _AVI),
    DefaultSEE("7315", _S, None,                     _D("1.970"), _D("0.390"),
               "Chain and parts thereof, of iron or steel", _AVI),
    DefaultSEE("7316", _S, None,                     _D("1.970"), _D("0.390"),
               "Anchors, grapnels and parts thereof, of iron or steel", _AVI),
    DefaultSEE("7317", _S, None,                     _D("1.890"), _D("0.320"),
               "Nails, tacks, drawing pins, corrugated nails, staples (iron/steel)", _AVI),
    DefaultSEE("731815", _S, None,                   _D("2.100"), _D("1.990"),
               "Screws, bolts, nuts, washers — stainless steel (7318 15, 16)", _AVI),
    DefaultSEE("7318", _S, None,                     _D("1.890"), _D("0.320"),
               "Screws, bolts, nuts, coach screws, washers — non-stainless", _AVI),
    DefaultSEE("7319", _S, None,                     _D("1.890"), _D("0.320"),
               "Sewing needles, knitting needles, bodkins, crochet hooks", _AVI),
    DefaultSEE("7320", _S, None,                     _D("1.970"), _D("0.390"),
               "Springs and leaves for springs, of iron or steel", _AVI),
    DefaultSEE("7321", _S, None,                     _D("1.970"), _D("0.390"),
               "Stoves, ranges, grates, cookers, barbecues, of iron or steel", _AVI),
    DefaultSEE("7322", _S, None,                     _D("1.970"), _D("0.390"),
               "Radiators for central heating (non-electric), parts thereof", _AVI),
    DefaultSEE("7323", _S, None,                     _D("1.970"), _D("0.390"),
               "Table, kitchen or household articles of iron or steel", _AVI),
    DefaultSEE("7324", _S, None,                     _D("1.970"), _D("0.390"),
               "Sanitary ware and parts thereof, of iron or steel", _AVI),
    DefaultSEE("7325", _S, None,                     _D("2.210"), _D("0.350"),
               "Other cast articles of iron or steel", _AVI),
    DefaultSEE("732610", _S, None,                   _D("2.650"), _D("0.620"),
               "Other articles of iron or steel, forged (7326 10 00)", _AVI),
    DefaultSEE("732620", _S, None,                   _D("1.950"), _D("0.510"),
               "Articles of iron or steel wire (7326 20 00)", _AVI),
    DefaultSEE("7326", _S, None,                     _D("1.970"), _D("0.390"),
               "Other articles of iron or steel, Ch.73 (fallback)", _AVI),

    # ── ALUMINIUM (Table 3) ───────────────────────────────────────────────────
    # Official Art. 4(3) world-average values.  The official table does not
    # publish a SECONDARY route default; SECONDARY entries are engineering
    # estimates for actual-measurement use only.
    DefaultSEE("7601", _A, None,                       _D("2.360"), _D("8.140"),
               "Unwrought aluminium — world average (official default)", _AVI),
    DefaultSEE("7601", _A, PRODUCTION_ROUTE_PRIMARY,   _D("2.360"), _D("8.140"),
               "Unwrought aluminium, primary (world-avg electricity)", _AVI),
    DefaultSEE("7601", _A, PRODUCTION_ROUTE_SECONDARY, _D("0.327"), _D("0.205"),
               "Unwrought aluminium, secondary — engineering estimate", _AVI),

    DefaultSEE("7602", _A, None,                       _D("0.050"), _D("0.010"),
               "Aluminium waste and scrap", _AVI),

    DefaultSEE("7603", _A, None,                       _D("2.480"), _D("8.400"),
               "Aluminium powders and flakes — world average", _AVI),
    DefaultSEE("7603", _A, PRODUCTION_ROUTE_SECONDARY, _D("0.420"), _D("0.265"),
               "Aluminium powders and flakes, secondary — engineering estimate", _AVI),

    DefaultSEE("760410", _A, None,                     _D("2.310"), _D("7.490"),
               "Aluminium bars/rods, not alloyed (7604 10) — world average", _AVI),
    DefaultSEE("760429", _A, None,                     _D("2.730"), _D("9.300"),
               "Aluminium profiles, not alloyed (7604 29) — world average", _AVI),
    DefaultSEE("7604", _A, None,                       _D("2.510"), _D("8.300"),
               "Aluminium bars, rods and profiles — world average (fallback)", _AVI),
    DefaultSEE("7604", _A, PRODUCTION_ROUTE_SECONDARY, _D("0.410"), _D("0.260"),
               "Aluminium bars, rods and profiles, secondary — engineering estimate", _AVI),

    DefaultSEE("7605", _A, None,                       _D("2.310"), _D("7.490"),
               "Aluminium wire — world average", _AVI),
    DefaultSEE("7605", _A, PRODUCTION_ROUTE_SECONDARY, _D("0.410"), _D("0.260"),
               "Aluminium wire, secondary — engineering estimate", _AVI),

    DefaultSEE("7606", _A, None,                       _D("2.860"), _D("9.250"),
               "Aluminium plates, sheets and strip — world average", _AVI),
    DefaultSEE("7606", _A, PRODUCTION_ROUTE_SECONDARY, _D("0.440"), _D("0.280"),
               "Aluminium plates, sheets and strip, secondary — engineering estimate", _AVI),

    DefaultSEE("7607", _A, None,                       _D("2.860"), _D("9.250"),
               "Aluminium foil — world average", _AVI),

    DefaultSEE("7608", _A, None,                       _D("2.730"), _D("9.300"),
               "Aluminium tubes and pipes — world average", _AVI),

    DefaultSEE("76", _A, None,                         _D("2.360"), _D("8.140"),
               "Other aluminium articles Ch.76 — world average (fallback)", _AVI),
    DefaultSEE("76", _A, PRODUCTION_ROUTE_SECONDARY,   _D("0.420"), _D("0.265"),
               "Other aluminium articles Ch.76, secondary — engineering estimate", _AVI),

    # ── FERTILISERS (Table 4) ─────────────────────────────────────────────────
    # N2O process emissions included in direct values for ammonium nitrate.
    # Ammonia values reflect full upstream (gas extraction + Haber-Bosch).
    DefaultSEE("28080000", _F, None, _D("2.560"), _D("0.050"),
               "Nitric acid; sulphonitric acids", _AVI),
    DefaultSEE("28141000", _F, None, _D("2.680"), _D("0.140"),
               "Anhydrous ammonia — world average (Haber-Bosch, incl. upstream)", _AVI),
    DefaultSEE("28142000", _F, None, _D("2.680"), _D("0.140"),
               "Ammonia in aqueous solution — world average", _AVI),
    DefaultSEE("28332100", _F, None, _D("0.042"), _D("0.006"),
               "Sulphates of magnesium", _AVI),
    DefaultSEE("28342100", _F, None, _D("1.820"), _D("0.060"),
               "Nitrates of potassium", _AVI),

    # Heading 3102 — Nitrogenous mineral/chemical fertilisers
    DefaultSEE("31021000", _F, None, _D("1.780"), _D("0.120"),
               "Urea (CO2 from process + upstream gas)", _AVI),
    DefaultSEE("31022100", _F, None, _D("0.860"), _D("0.090"),
               "Ammonium sulphate", _AVI),
    DefaultSEE("31022900", _F, None, _D("0.860"), _D("0.090"),
               "Double salts / mixtures of ammonium sulphate", _AVI),
    DefaultSEE("31023010", _F, None, _D("2.320"), _D("0.070"),
               "Ammonium nitrate in aqueous solution (N2O included)", _AVI),
    DefaultSEE("31023090", _F, None, _D("2.320"), _D("0.070"),
               "Ammonium nitrate, other forms (N2O included)", _AVI),
    DefaultSEE("31024010", _F, None, _D("1.444"), _D("0.060"),
               "Ammonium nitrate + calcium carbonate mix", _AVI),
    DefaultSEE("31024090", _F, None, _D("1.444"), _D("0.060"),
               "Other ammonium nitrate mixtures", _AVI),
    DefaultSEE("31025000", _F, None, _D("3.990"), _D("0.070"),
               "Sodium nitrate", _AVI),
    DefaultSEE("31026000", _F, None, _D("1.444"), _D("0.060"),
               "Double salts of calcium nitrate and ammonium nitrate", _AVI),
    DefaultSEE("31028000", _F, None, _D("1.780"), _D("0.120"),
               "Urea + ammonium nitrate solution (UAN)", _AVI),
    DefaultSEE("31029000", _F, None, _D("2.680"), _D("0.140"),
               "Other nitrogenous fertilisers (default = ammonia equivalent)", _AVI),

    # Heading 3105 — Compound / NPK fertilisers
    DefaultSEE("31051000", _F, None, _D("0.940"), _D("0.080"),
               "Fertilisers in tablets or packages ≤10 kg", _AVI),
    DefaultSEE("31052010", _F, None, _D("1.230"), _D("0.110"),
               "Three-element NPK fertilisers (N+P+K)", _AVI),
    DefaultSEE("31052090", _F, None, _D("1.230"), _D("0.110"),
               "Other three-element fertilisers", _AVI),
    DefaultSEE("31053000", _F, None, _D("0.690"), _D("0.060"),
               "Diammonium phosphate (DAP)", _AVI),
    DefaultSEE("31054000", _F, None, _D("0.440"), _D("0.050"),
               "Monoammonium phosphate (MAP)", _AVI),
    DefaultSEE("31055100", _F, None, _D("1.290"), _D("0.110"),
               "Nitrophosphates (N+P)", _AVI),
    DefaultSEE("31055900", _F, None, _D("1.290"), _D("0.110"),
               "Other N+P fertilisers", _AVI),
    DefaultSEE("3105", _F, None,    _D("0.940"), _D("0.080"),
               "Compound fertilisers Ch.3105 — world average (fallback)", _AVI),

    # ── ELECTRICITY (Table 5) ─────────────────────────────────────────────────
    # Unit: tCO2e per MWh.  Country-specific values in ELECTRICITY_FACTORS below.
    # Entry below is the IEA world-average fallback when no country factor is available.
    DefaultSEE("27160000", _E, None, _D("0.493"), _D("0.000"),
               "Electrical energy — world average IEA grid emission factor", _AVI),

    # ── HYDROGEN (Table 6) ────────────────────────────────────────────────────
    # Official Art. 4(3) default is a single world-average (JRC 2023 H2 mix).
    # Route-specific entries are engineering estimates for actual-measurement use.
    DefaultSEE("28041000", _H, None,                    _D("10.400"), _D("0.000"),
               "Hydrogen — world average (official default, JRC 2023 production mix)", _AVI),
    DefaultSEE("28041000", _H, PRODUCTION_ROUTE_SMR,    _D("9.000"),  _D("0.000"),
               "Hydrogen — steam methane reforming, SMR (engineering estimate)", _AVI),
    DefaultSEE("28041000", _H, PRODUCTION_ROUTE_COAL_GAS, _D("19.000"), _D("0.000"),
               "Hydrogen — coal gasification (engineering estimate)", _AVI),
    DefaultSEE("28041000", _H, PRODUCTION_ROUTE_ELECTRO, _D("0.000"),  _D("0.000"),
               "Hydrogen — electrolysis (indirect via ELECTRICITY_FACTORS)", _AVI),
]


# ── Country-specific electricity emission factors (tCO2e per MWh) ────────────
# Source: IEA 5-year average 2016–2020, applied via Art. 4(3) operative table.
# Used for indirect embedded emissions in non-electricity CBAM goods.
# Country ISO-3166-1 alpha-2 codes.
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

# Compute table SHA-256 once — covers both _ANNEX_VI entries and ELECTRICITY_FACTORS.
# This auto-updates whenever a value is changed, giving auditors a tamper-evident
# fingerprint of the exact data used in a calculation.
_FACTOR_TABLE_SHA256: str = hashlib.sha256(
    json.dumps(
        {
            "annex_vi": sorted(
                [
                    [
                        e.cn8_prefix,
                        e.sector,
                        e.production_route or "",
                        str(e.direct_tco2e_per_t),
                        str(e.indirect_tco2e_per_t),
                    ]
                    for e in _ANNEX_VI
                ]
            ),
            "electricity": {k: str(v) for k, v in sorted(ELECTRICITY_FACTORS.items())},
        },
        sort_keys=True,
    ).encode("utf-8")
).hexdigest()

FACTOR_METADATA["table_sha256"] = _FACTOR_TABLE_SHA256


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
        When *None*, the function returns the official world-average default.

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
