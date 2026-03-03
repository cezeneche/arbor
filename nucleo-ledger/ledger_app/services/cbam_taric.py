"""
CBAM TARIC CN Code → Sector Lookup

Source: EU Regulation (EU) 2023/956 of the European Parliament and of the
        Council of 10 May 2023 establishing a carbon border adjustment
        mechanism, Annex I — Goods covered by CBAM.
        OJ L 130, 16.5.2023, pp. 52–58.

        Commission Implementing Regulation (EU) 2023/1773 of 17 August 2023
        laying down the rules for the application of Regulation (EU) 2023/956.

This module provides a deterministic, regulation-grounded mapping from EU
Combined Nomenclature (CN) codes to CBAM sectors.  It does NOT guess or fall
back to a default sector — an unknown CN code is explicitly flagged as out of
scope so that the calling pipeline can handle it appropriately.

Public API
----------
lookup_sector(cn_code) -> str | None
    Return the CBAM sector string for a CN code, or None if the code is not
    covered by CBAM Annex I.

is_in_cbam_scope(cn_code) -> bool
    True if the CN code falls under CBAM Annex I coverage.

CBAMCodeNotInScope
    Exception raised by callers that need a hard failure for out-of-scope
    codes (e.g. validation endpoints).
"""

from __future__ import annotations

__all__ = [
    "SECTOR_CEMENT",
    "SECTOR_IRON_STEEL",
    "SECTOR_ALUMINIUM",
    "SECTOR_FERTILISERS",
    "SECTOR_ELECTRICITY",
    "SECTOR_HYDROGEN",
    "CBAMCodeNotInScope",
    "lookup_sector",
    "is_in_cbam_scope",
]

# ── Sector identifiers (match DB CHECK constraint values) ────────────────────
SECTOR_CEMENT = "cement"
SECTOR_IRON_STEEL = "iron_steel"
SECTOR_ALUMINIUM = "aluminium"
SECTOR_FERTILISERS = "fertilisers"
SECTOR_ELECTRICITY = "electricity"
SECTOR_HYDROGEN = "hydrogen"

_C = SECTOR_CEMENT
_S = SECTOR_IRON_STEEL
_A = SECTOR_ALUMINIUM
_F = SECTOR_FERTILISERS
_E = SECTOR_ELECTRICITY
_H = SECTOR_HYDROGEN


# ── Full-heading coverage ────────────────────────────────────────────────────
# Every CN code whose first 4 digits match one of these keys is in scope.
# Only headings where ALL subheadings are covered by CBAM Annex I are listed.
#
# Regulation reference: Annex I, Sections A–F.
_HEADING_TO_SECTOR: dict[str, str] = {
    # ── CEMENT (Annex I, Section A) ──────────────────────────────────────────
    # Heading 2523: Portland cement, aluminous cement, slag cement,
    #   supersulphate cement and similar hydraulic cements
    "2523": _C,

    # ── IRON AND STEEL (Annex I, Section B) ─────────────────────────────────
    # Chapter 72 — Iron and steel (all headings in scope)
    "7201": _S,  # Pig iron and spiegeleisen in pigs, blocks or other primary forms
    "7202": _S,  # Ferro-alloys
    "7203": _S,  # Ferrous products obtained by direct reduction of iron ore
    "7204": _S,  # Ferrous waste and scrap; remelting scrap ingots of iron or steel
    "7205": _S,  # Granules and powders, of pig iron, spiegeleisen, iron or steel
    "7206": _S,  # Iron and non-alloy steel in ingots or other primary forms
    "7207": _S,  # Semi-finished products of iron or non-alloy steel
    "7208": _S,  # Flat-rolled products of iron or non-alloy steel, ≥600 mm wide, hot-rolled
    "7209": _S,  # Flat-rolled products of iron or non-alloy steel, ≥600 mm wide, cold-rolled
    "7210": _S,  # Flat-rolled products of iron or non-alloy steel, ≥600 mm, clad/plated/coated
    "7211": _S,  # Flat-rolled products of iron or non-alloy steel, <600 mm wide, hot-rolled
    "7212": _S,  # Flat-rolled products of iron or non-alloy steel, <600 mm, clad/plated/coated
    "7213": _S,  # Bars and rods of iron or non-alloy steel, hot-rolled, in irregularly wound coils
    "7214": _S,  # Other bars and rods of iron or non-alloy steel, not further worked than forged
    "7215": _S,  # Other bars and rods of iron or non-alloy steel
    "7216": _S,  # Angles, shapes and sections of iron or non-alloy steel
    "7217": _S,  # Wire of iron or non-alloy steel
    "7218": _S,  # Stainless steel in ingots or other primary forms; semi-finished products
    "7219": _S,  # Flat-rolled products of stainless steel, ≥600 mm wide
    "7220": _S,  # Flat-rolled products of stainless steel, <600 mm wide
    "7221": _S,  # Bars and rods of stainless steel, hot-rolled, in irregularly wound coils
    "7222": _S,  # Other bars and rods of stainless steel; angles, shapes and sections
    "7223": _S,  # Wire of stainless steel
    "7224": _S,  # Other alloy steel in ingots or other primary forms; semi-finished products
    "7225": _S,  # Flat-rolled products of other alloy steel, ≥600 mm wide
    "7226": _S,  # Flat-rolled products of other alloy steel, <600 mm wide
    "7227": _S,  # Bars and rods of other alloy steel, hot-rolled, in irregularly wound coils
    "7228": _S,  # Other bars and rods of other alloy steel; hollow drill bars and rods
    "7229": _S,  # Wire of other alloy steel
    # Chapter 73 — Articles of iron or steel
    # Note: heading 7313 (barbed wire) is NOT listed in CBAM Annex I and is excluded.
    "7301": _S,  # Sheet piling of iron or steel; welded angles, shapes and sections
    "7302": _S,  # Railway or tramway track construction material
    "7303": _S,  # Tubes, pipes and hollow profiles, of cast iron
    "7304": _S,  # Tubes, pipes and hollow profiles, seamless, of iron (other than cast iron) or steel
    "7305": _S,  # Other tubes and pipes (welded), having circular cross-section, ext. diam >406.4 mm
    "7306": _S,  # Other tubes, pipes and hollow profiles (welded, riveted or similarly closed)
    "7307": _S,  # Tube or pipe fittings (couplings, elbows, sleeves) of iron or steel
    "7308": _S,  # Structures and parts of structures of iron or steel
    "7309": _S,  # Reservoirs, tanks, vats and similar containers, capacity >300 L, iron or steel
    "7310": _S,  # Tanks, casks, drums, cans, boxes and similar containers, capacity ≤300 L
    "7311": _S,  # Containers for compressed or liquefied gas, of iron or steel
    "7312": _S,  # Stranded wire, ropes, cables, plaited bands, slings and the like, of iron or steel
    # 7313 excluded — barbed wire of iron or steel (NOT in CBAM Annex I)
    "7314": _S,  # Cloth (including endless bands), grill, netting and fencing, of iron or steel wire
    "7315": _S,  # Chain and parts thereof, of iron or steel
    "7316": _S,  # Anchors, grapnels and parts thereof, of iron or steel
    "7317": _S,  # Nails, tacks, drawing pins, corrugated nails, staples and similar
    "7318": _S,  # Screws, bolts, nuts, coach screws, screw hooks, rivets, cotters, cotter-pins
    "7319": _S,  # Sewing needles, knitting needles, bodkins, crochet hooks, embroidery stilettos
    "7320": _S,  # Springs and leaves for springs, of iron or steel
    "7321": _S,  # Stoves, ranges, grates, cookers (including those with subsidiary boilers)
    "7322": _S,  # Radiators for central heating, not electrically heated; air heaters and hot air distributors
    "7323": _S,  # Table, kitchen or other household articles and parts thereof, of iron or steel
    "7324": _S,  # Sanitary ware and parts thereof, of iron or steel
    "7325": _S,  # Other cast articles of iron or steel
    "7326": _S,  # Other articles of iron or steel

    # ── ALUMINIUM (Annex I, Section C) ──────────────────────────────────────
    "7601": _A,  # Unwrought aluminium
    "7602": _A,  # Aluminium waste and scrap
    "7603": _A,  # Aluminium powders and flakes
    "7604": _A,  # Aluminium bars, rods and profiles
    "7605": _A,  # Aluminium wire
    "7606": _A,  # Aluminium plates, sheets and strip, of a thickness exceeding 0.2 mm
    "7607": _A,  # Aluminium foil (whether or not printed or backed) of a thickness ≤0.2 mm
    "7608": _A,  # Aluminium tubes and pipes
    "7609": _A,  # Aluminium tube or pipe fittings (couplings, elbows, sleeves)
    "7610": _A,  # Aluminium structures (excl. prefabricated buildings of heading 9406) and parts
    "7611": _A,  # Aluminium reservoirs, tanks, vats and similar containers, capacity >300 L
    "7612": _A,  # Aluminium casks, drums, cans, boxes and similar containers, capacity ≤300 L
    "7613": _A,  # Aluminium containers for compressed or liquefied gas
    "7614": _A,  # Stranded wire, cables, plaited bands and the like, of aluminium
    "7615": _A,  # Table, kitchen or other household articles and parts thereof, of aluminium
    "7616": _A,  # Other articles of aluminium
}


# ── Specific 8-digit CN code overrides ──────────────────────────────────────
# Used where only certain subheadings within a heading are covered by CBAM.
# Key: exactly 8 digits (no spaces, dashes or dots).
# Regulation reference: Annex I, Sections A, D, E, F.
_CN8_TO_SECTOR: dict[str, str] = {
    # ── CEMENT — calcined kaolin (partial heading 2507) ──────────────────────
    # Only CN 2507 00 80 (calcined) is in scope; 2507 00 20 (uncalcined) is not.
    "25070080": _C,

    # ── ELECTRICITY (heading 2716 — single CN8) ──────────────────────────────
    "27160000": _E,

    # ── HYDROGEN (partial heading 2804) ──────────────────────────────────────
    # Only 2804 10 00 (hydrogen) is in scope; other subheadings of 2804 are not.
    "28041000": _H,

    # ── FERTILISERS — Chapter 28 partial headings ─────────────────────────────
    "28080000": _F,  # Nitric acid; sulphonitric acids
    "28141000": _F,  # Anhydrous ammonia
    "28142000": _F,  # Ammonia in aqueous solution
    "28332100": _F,  # Sulphates of magnesium (partial heading 2833)
    "28342100": _F,  # Nitrates of potassium (partial heading 2834)

    # ── FERTILISERS — Heading 3102 (nitrogenous mineral/chemical fertilisers) ─
    "31021000": _F,  # Urea, whether or not in aqueous solution
    "31021090": _F,  # Urea, other forms
    "31022100": _F,  # Ammonium sulphate
    "31022900": _F,  # Double salts and mixtures of ammonium sulphate and ammonium nitrate
    "31023010": _F,  # Ammonium nitrate, in aqueous solution
    "31023090": _F,  # Ammonium nitrate, other
    "31024010": _F,  # Mixtures of ammonium nitrate with calcium carbonate or other inorganic matter
    "31024090": _F,  # Other mixtures of ammonium nitrate
    "31025000": _F,  # Sodium nitrate
    "31026000": _F,  # Double salts of calcium nitrate and ammonium nitrate
    "31028000": _F,  # Mixtures of urea and ammonium nitrate in aqueous or ammoniacal solution
    "31029000": _F,  # Other nitrogenous mineral or chemical fertilisers

    # ── FERTILISERS — Heading 3105 (mineral/chemical fertilisers, multiple elements) ─
    "31051000": _F,  # Goods in tablets or similar forms or in packages of a gross weight ≤10 kg
    "31052010": _F,  # Mineral or chemical fertilisers containing nitrogen, phosphorus and potassium
    "31052090": _F,  # Other mineral or chemical fertilisers with three fertilising elements
    "31053000": _F,  # Di-ammonium hydrogenorthophosphate (diammonium phosphate)
    "31054000": _F,  # Ammonium dihydrogenorthophosphate (monoammonium phosphate)
    "31055100": _F,  # Nitrophosphates
    "31055900": _F,  # Other mineral or chemical fertilisers containing nitrogen and phosphorus
    "31059010": _F,  # Other fertilisers containing phosphorus and potassium
    "31059091": _F,  # Other fertilisers
    "31059099": _F,  # Other fertilisers (residual)
}


class CBAMCodeNotInScope(ValueError):
    """Raised when a CN code is not covered by CBAM Annex I.

    Attributes
    ----------
    cn_code : str
        The normalised (digits-only) CN code that was looked up.
    regulation : str
        Citation for the regulation that defines coverage.
    """

    regulation: str = (
        "EU Regulation 2023/956, Annex I (OJ L 130, 16.5.2023, pp. 52–58)"
    )

    def __init__(self, cn_code: str) -> None:
        self.cn_code = cn_code
        super().__init__(
            f"CN code '{cn_code}' is not covered by CBAM Annex I "
            f"({self.regulation})."
        )


def _normalize(cn_code: str) -> str:
    """Strip non-digit characters from a CN code."""
    return "".join(ch for ch in cn_code if ch.isdigit())


def lookup_sector(cn_code: str) -> str | None:
    """Return the CBAM sector for a CN code, or *None* if not in scope.

    The lookup is deterministic and sourced exclusively from
    EU Regulation 2023/956, Annex I.

    Resolution order
    ----------------
    1. Exact 8-digit match in ``_CN8_TO_SECTOR`` (handles partial headings).
    2. 4-digit HS heading match in ``_HEADING_TO_SECTOR`` (full-heading
       coverage).
    3. ``None`` — the code is not covered by CBAM Annex I.

    Parameters
    ----------
    cn_code:
        A CN code string in any format (spaces, dots and dashes are stripped).
        Accepts 4-, 6-, 8- or 10-digit codes; only the first 8 digits are used.

    Returns
    -------
    str | None
        One of the ``SECTOR_*`` constants, or *None* when the CN code is not
        in CBAM Annex I scope.
    """
    normalized = _normalize(cn_code)
    if not normalized:
        return None

    # 1. Exact 8-digit match (handles partial headings such as 2507, 2804, etc.)
    cn8 = normalized[:8].ljust(8, "0") if len(normalized) < 8 else normalized[:8]
    # Only attempt CN8 lookup when the caller actually provided ≥6 digits,
    # otherwise zero-padding produces false positives.
    if len(normalized) >= 6:
        if cn8 in _CN8_TO_SECTOR:
            return _CN8_TO_SECTOR[cn8]

    # 2. 4-digit HS heading match
    heading = normalized[:4]
    if heading in _HEADING_TO_SECTOR:
        return _HEADING_TO_SECTOR[heading]

    return None


def is_in_cbam_scope(cn_code: str) -> bool:
    """Return *True* if the CN code is covered by CBAM Annex I.

    Parameters
    ----------
    cn_code:
        A CN code string in any format.
    """
    return lookup_sector(cn_code) is not None
