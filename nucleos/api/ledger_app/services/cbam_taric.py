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

import hashlib
import json

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
    "TARIC_METADATA",
]

# Sector identifiers (match DB CHECK constraint values)
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


# Annex I as published: Regulation (EU) 2023/956, Annex I (OJ L 130,
# 16.5.2023, pp. 52–58), checked on 30 September 2026. GOV.UK's "Check which
# goods are in scope of CBAM" (16 July 2026) lists the same codes for the five
# sectors the UK covers; the UK does not cover electricity.
#
# Annex I names whole headings where it can, so this table does too: a heading
# covers every current and future CN8 beneath it (for example the urea codes
# 3102 10 12 / 15 / 19 that replaced 3102 10 10 in 2025).

# Full-heading coverage
# Every CN code whose first 4 digits match one of these keys is in scope,
# unless _EXCLUDED_PREFIXES says otherwise.
_HEADING_TO_SECTOR: dict[str, str] = {
    # CEMENT
    "2523": _C,  # Portland, aluminous, slag, supersulphate and similar hydraulic cements

    # FERTILISERS
    "2814": _F,  # Ammonia, anhydrous or in aqueous solution
    "3102": _F,  # Mineral or chemical fertilisers, nitrogenous
    "3105": _F,  # Fertilisers with two or three of N, P, K (except 3105 60 00)

    # IRON AND STEEL — "72 Iron and steel", except the ferro-alloys and scrap
    # below. 7202 is only partly covered, so it is listed by subheading.
    "7201": _S,  # Pig iron and spiegeleisen
    "7203": _S,  # Ferrous products obtained by direct reduction of iron ore
    "7205": _S,  # Granules and powders, of pig iron, spiegeleisen, iron or steel
    "7206": _S,  # Iron and non-alloy steel in ingots or other primary forms
    "7207": _S,  # Semi-finished products of iron or non-alloy steel
    "7208": _S,  # Flat-rolled, ≥600 mm, hot-rolled
    "7209": _S,  # Flat-rolled, ≥600 mm, cold-rolled
    "7210": _S,  # Flat-rolled, ≥600 mm, clad, plated or coated
    "7211": _S,  # Flat-rolled, <600 mm, not clad, plated or coated
    "7212": _S,  # Flat-rolled, <600 mm, clad, plated or coated
    "7213": _S,  # Bars and rods, hot-rolled, in irregularly wound coils
    "7214": _S,  # Other bars and rods, not further worked than forged or hot-rolled
    "7215": _S,  # Other bars and rods
    "7216": _S,  # Angles, shapes and sections
    "7217": _S,  # Wire of iron or non-alloy steel
    "7218": _S,  # Stainless steel in ingots; semi-finished products
    "7219": _S,  # Flat-rolled stainless, ≥600 mm
    "7220": _S,  # Flat-rolled stainless, <600 mm
    "7221": _S,  # Stainless bars and rods, in irregularly wound coils
    "7222": _S,  # Other stainless bars and rods; angles, shapes and sections
    "7223": _S,  # Wire of stainless steel
    "7224": _S,  # Other alloy steel in ingots; semi-finished products
    "7225": _S,  # Flat-rolled other alloy steel, ≥600 mm
    "7226": _S,  # Flat-rolled other alloy steel, <600 mm
    "7227": _S,  # Other alloy steel bars and rods, in irregularly wound coils
    "7228": _S,  # Other bars and rods of other alloy steel
    "7229": _S,  # Wire of other alloy steel
    # Chapter 73 — only these headings are listed in Annex I
    "7301": _S,  # Sheet piling; welded angles, shapes and sections
    "7302": _S,  # Railway or tramway track construction material
    "7303": _S,  # Tubes, pipes and hollow profiles, of cast iron
    "7304": _S,  # Tubes, pipes and hollow profiles, seamless
    "7305": _S,  # Other tubes and pipes, circular, external diameter >406.4 mm
    "7306": _S,  # Other tubes, pipes and hollow profiles
    "7307": _S,  # Tube or pipe fittings
    "7308": _S,  # Structures and parts of structures
    "7309": _S,  # Reservoirs, tanks, vats, >300 l
    "7310": _S,  # Tanks, casks, drums, cans, boxes, ≤300 l
    "7311": _S,  # Containers for compressed or liquefied gas
    "7318": _S,  # Screws, bolts, nuts, rivets, washers and similar
    "7326": _S,  # Other articles of iron or steel

    # ALUMINIUM — 7602 (scrap) and 7615 (household articles) are not listed
    "7601": _A,  # Unwrought aluminium
    "7603": _A,  # Powders and flakes
    "7604": _A,  # Bars, rods and profiles
    "7605": _A,  # Wire
    "7606": _A,  # Plates, sheets and strip, >0.2 mm
    "7607": _A,  # Foil, ≤0.2 mm
    "7608": _A,  # Tubes and pipes
    "7609": _A,  # Tube or pipe fittings
    "7610": _A,  # Structures and parts of structures
    "7611": _A,  # Reservoirs, tanks, vats, >300 l
    "7612": _A,  # Casks, drums, cans, boxes, ≤300 l
    "7613": _A,  # Containers for compressed or liquefied gas
    "7614": _A,  # Stranded wire, cables, plaited bands, not insulated
    "7616": _A,  # Other articles of aluminium
}

# Subheading coverage (6 digits) inside headings Annex I covers only in part.
_CN6_TO_SECTOR: dict[str, str] = {
    "260112": _S,  # Agglomerated iron ores and concentrates
    # 7202 — ferro-alloys Annex I does not except
    "720211": _S,  # Ferro-manganese, >2% carbon
    "720219": _S,  # Ferro-manganese, other
    "720241": _S,  # Ferro-chromium, >4% carbon
    "720249": _S,  # Ferro-chromium, other
    "720260": _S,  # Ferro-nickel
    "283421": _F,  # Nitrates of potassium
}

# Exact 8-digit codes inside headings Annex I covers only in part.
_CN8_TO_SECTOR: dict[str, str] = {
    "25070080": _C,  # Other kaolinic clays
    "27160000": _E,  # Electrical energy (EU only)
    "28041000": _H,  # Hydrogen
    "28080000": _F,  # Nitric acid; sulphonitric acids
}

# Codes Annex I names with "Except", inside headings covered above.
_EXCLUDED_PREFIXES: tuple[str, ...] = (
    "310560",  # Fertilisers containing only phosphorus and potassium
)


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
    1. A prefix in ``_EXCLUDED_PREFIXES`` (Annex I "Except") → ``None``.
    2. Exact 8-digit match in ``_CN8_TO_SECTOR`` (partial headings).
    3. 6-digit match in ``_CN6_TO_SECTOR`` (partial headings).
    4. 4-digit HS heading match in ``_HEADING_TO_SECTOR`` (full-heading
       coverage).
    5. ``None`` — the code is not covered by CBAM Annex I.

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

    # Only attempt subheading lookups when the caller provided ≥6 digits,
    # otherwise zero-padding produces false positives.
    if len(normalized) >= 6:
        # 1. Codes Annex I excepts from a covered heading
        if normalized.startswith(_EXCLUDED_PREFIXES):
            return None

        # 2. Exact 8-digit match (partial headings such as 2507, 2804, 2808)
        cn8 = normalized[:8].ljust(8, "0")
        if cn8 in _CN8_TO_SECTOR:
            return _CN8_TO_SECTOR[cn8]

        # 3. 6-digit subheading match (partial headings such as 2601, 7202, 2834)
        if normalized[:6] in _CN6_TO_SECTOR:
            return _CN6_TO_SECTOR[normalized[:6]]

    # 4. 4-digit heading match
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


# TARIC table provenance metadata
# Computed once at import time so it auto-updates when any table entry changes.
# Include TARIC_METADATA in every calculation snapshot and in the
# GET /api/cbam/regulatory-tables response for third-party audit verification.

TARIC_TABLE_VERSION = "2023-956-AnnexI-checked-2026-09-30"
_TARIC_TABLE_SHA256 = hashlib.sha256(
    json.dumps(
        {
            "headings": _HEADING_TO_SECTOR,
            "cn6": _CN6_TO_SECTOR,
            "cn8": _CN8_TO_SECTOR,
            "excluded": list(_EXCLUDED_PREFIXES),
        },
        sort_keys=True,
    ).encode("utf-8")
).hexdigest()

TARIC_METADATA: dict[str, str] = {
    "table_version": TARIC_TABLE_VERSION,
    "regulation": "Regulation (EU) 2023/956, Annex I",
    "oj_reference": "OJ L 130, 16.5.2023",
    "effective_date": "2023-05-16",
    "review_cadence": "annual",
    "sha256": _TARIC_TABLE_SHA256,
}
