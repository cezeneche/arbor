"""
CBAM CN Code Classification Service
====================================

Classifies a free-text product description to the most likely CBAM Combined
Nomenclature (CN) code and sector, using a two-stage strategy:

  1. Deterministic keyword / phrase table (fast, auditable, no external calls).
  2. Optional Claude LLM fallback (haiku model, JSON-mode) when keyword
     confidence is below the trigger threshold.

Public API
----------
classify_description(description, hint_cn_code=None, llm_fallback=True)
    -> CNClassificationResult

Constants
---------
AUTO_ASSIGN_THRESHOLD   Decimal("0.70")  — auto-assign, no review flag
LLM_TRIGGER_THRESHOLD   Decimal("0.60")  — below this, try LLM (if enabled)
REVIEW_THRESHOLD        Decimal("0.40")  — below this, always requires_review

Regulation reference: EU 2023/956 (Annex I) + EU 2023/1773 (methodology).
"""

from __future__ import annotations

import json
import logging
import os
import re
import unicodedata
from dataclasses import dataclass
from dataclasses import field
from decimal import Decimal
from typing import Any

from ledger_app.services.cbam_taric import is_in_cbam_scope
from ledger_app.services.cbam_taric import lookup_sector

_logger = logging.getLogger("ledger.cbam_classifier")

# ── Thresholds ────────────────────────────────────────────────────────────────

AUTO_ASSIGN_THRESHOLD: Decimal = Decimal("0.70")
LLM_TRIGGER_THRESHOLD: Decimal = Decimal("0.60")
REVIEW_THRESHOLD: Decimal = Decimal("0.40")

# ── Data structures ───────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ClassifierEntry:
    """A single entry in the CBAM keyword classification table.

    Attributes
    ----------
    cn_code:
        8-digit preferred; 4-digit accepted for heading-level matches.
    sector:
        CBAM sector string matching the TARIC table (e.g. ``"iron_steel"``).
    label:
        Human-readable product name used in candidate lists / prompts.
    phrases:
        High-confidence multi-word phrases.  Any match sets score to 0.92.
    synonyms:
        Secondary phrases / abbreviations.  Any match sets score to 0.78.
    keywords:
        Individual keywords that each contribute +0.12 (additive, capped at
        0.60 as keyword_boost before merging with phrase/synonym score).
    excludes:
        If any of these tokens appear in the normalised description the final
        score is multiplied by 0.5 per match.
    """

    cn_code: str
    sector: str
    label: str
    phrases: list[str] = field(default_factory=list)
    synonyms: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    excludes: list[str] = field(default_factory=list)


@dataclass
class CNClassificationResult:
    """Result returned by :func:`classify_description`.

    Attributes
    ----------
    cn_code:
        Best-match CN code.
    sector:
        CBAM sector string.
    confidence:
        Decimal in [0, 1].
    method:
        One of ``"keyword"``, ``"llm"``, ``"combined"``,
        ``"extracted_from_text"`` or ``"hint"``.
    requires_review:
        ``True`` when confidence < AUTO_ASSIGN_THRESHOLD or the code was
        flagged by the LLM as uncertain.
    candidates:
        Top-5 candidate dicts with keys ``cn_code``, ``sector``, ``label``,
        ``confidence``, ``method``.
    review_reason:
        Human-readable explanation for the review flag, or ``None``.
    """

    cn_code: str
    sector: str
    confidence: Decimal
    method: str
    requires_review: bool
    candidates: list[dict[str, Any]]
    review_reason: str | None = None


# ── Keyword / phrase classification table ────────────────────────────────────
# Ordered for fast iteration; scoring is O(n·m) so keep n manageable.

_CLASSIFIER_TABLE: list[ClassifierEntry] = [
    # =========================================================================
    # CEMENT
    # =========================================================================
    ClassifierEntry(
        cn_code="25231000",
        sector="cement",
        label="Cement clinker",
        phrases=["cement clinker", "portland clinker"],
        synonyms=["clinker"],
        keywords=["cement", "calcination"],
    ),
    ClassifierEntry(
        cn_code="25232900",
        sector="cement",
        label="Grey Portland cement",
        phrases=[
            "ordinary portland cement",
            "grey portland cement",
            "OPC",
            "portland cement grey",
        ],
        synonyms=["cement grey", "standard cement", "bulk cement"],
        keywords=["portland", "cement", "OPC", "grey"],
    ),
    ClassifierEntry(
        cn_code="25232100",
        sector="cement",
        label="White Portland cement",
        phrases=["white portland cement", "white cement"],
        synonyms=["WPC"],
        keywords=["white", "portland", "cement"],
    ),
    ClassifierEntry(
        cn_code="25233000",
        sector="cement",
        label="Aluminous cement",
        phrases=[
            "aluminous cement",
            "high alumina cement",
            "calcium aluminate cement",
        ],
        synonyms=["HAC", "CAC"],
        keywords=["aluminous", "alumina", "refractory cement"],
    ),
    ClassifierEntry(
        cn_code="25239000",
        sector="cement",
        label="Other hydraulic cement",
        phrases=[
            "hydraulic cement",
            "blast furnace slag cement",
            "pozzolanic cement",
            "fly ash cement",
        ],
        synonyms=["GGBS cement", "pozzolan cement"],
        keywords=["hydraulic", "slag", "pozzolan", "fly ash"],
    ),
    ClassifierEntry(
        cn_code="25070080",
        sector="cement",
        label="Calcined kaolin / metakaolin",
        phrases=["calcined kaolin", "calcined kaolinite", "metakaolin"],
        synonyms=["calcined clay"],
        keywords=["calcined", "kaolin", "metakaolin"],
    ),
    # =========================================================================
    # IRON & STEEL
    # =========================================================================
    ClassifierEntry(
        cn_code="7201",
        sector="iron_steel",
        label="Pig iron / spiegeleisen",
        phrases=["pig iron", "blast furnace pig iron", "cast iron ingot"],
        synonyms=["spiegeleisen"],
        keywords=["pig", "blast furnace", "iron"],
    ),
    ClassifierEntry(
        cn_code="7203",
        sector="iron_steel",
        label="Sponge iron / DRI / HBI",
        phrases=["sponge iron", "direct reduced iron", "hot briquetted iron"],
        synonyms=["DRI", "HBI", "CDRI"],
        keywords=["sponge", "reduced iron", "direct reduction"],
    ),
    ClassifierEntry(
        cn_code="7204",
        sector="iron_steel",
        label="Ferrous scrap",
        phrases=["steel scrap", "ferrous scrap", "iron scrap", "recycled steel"],
        synonyms=["HMS", "shredded scrap"],
        keywords=["scrap", "recycled", "waste steel"],
        excludes=["stainless"],
    ),
    ClassifierEntry(
        cn_code="7207",
        sector="iron_steel",
        label="Semi-finished steel products (billet / slab / bloom)",
        phrases=[
            "steel billet",
            "steel slab",
            "steel bloom",
            "continuous cast slab",
            "continuously cast billet",
        ],
        synonyms=["CC slab", "CC billet", "billets", "slabs"],
        keywords=["billet", "slab", "bloom", "semi-finished", "feedstock"],
        excludes=["aluminium", "aluminum", "copper"],
    ),
    ClassifierEntry(
        cn_code="7208",
        sector="iron_steel",
        label="Hot-rolled coil / sheet / plate ≥600 mm",
        phrases=[
            "hot rolled coil",
            "hot rolled sheet",
            "hot rolled plate",
            "hot rolled strip",
            "HR coil",
            "HRC steel",
            "pickled and oiled coil",
        ],
        synonyms=["HRC", "HRPO", "hot rolled steel", "P&O coil", "hot roll"],
        keywords=["hot rolled", "hot roll", "coil", "strip"],
        excludes=["cold rolled", "stainless", "aluminium"],
    ),
    ClassifierEntry(
        cn_code="7209",
        sector="iron_steel",
        label="Cold-rolled coil / sheet / strip ≥600 mm",
        phrases=[
            "cold rolled coil",
            "cold rolled sheet",
            "cold rolled strip",
            "CR coil",
            "cold reduced strip",
        ],
        synonyms=["CRC", "CRCA", "cold rolled steel", "CR steel"],
        keywords=["cold rolled", "cold roll", "cold reduced"],
        excludes=["hot rolled", "stainless", "aluminium"],
    ),
    ClassifierEntry(
        cn_code="7210",
        sector="iron_steel",
        label="Coated / plated flat-rolled steel ≥600 mm",
        phrases=[
            "galvanized steel coil",
            "hot dip galvanized",
            "electrogalvanized coil",
            "galvalume",
            "aluminized steel",
            "tin plate",
            "zinc coated steel",
        ],
        synonyms=["HDG coil", "EG coil", "GI coil", "galv steel", "galvanised", "PPGI"],
        keywords=["galvanized", "galvanised", "zinc coated", "plated", "coated steel"],
        excludes=["stainless", "pipe", "tube"],
    ),
    ClassifierEntry(
        cn_code="7213",
        sector="iron_steel",
        label="Wire rod in coils",
        phrases=["wire rod", "steel wire rod", "rod in coil", "hot rolled wire rod"],
        synonyms=["WR coil", "SAE wire rod"],
        keywords=["wire rod", "rod coil"],
        excludes=["cold drawn", "stainless"],
    ),
    ClassifierEntry(
        cn_code="7214",
        sector="iron_steel",
        label="Reinforcing bar / structural bar",
        phrases=[
            "reinforcing bar",
            "reinforcement bar",
            "deformed bar",
            "TMT bar",
            "rebar",
            "steel bar",
            "round bar",
            "flat bar",
            "square bar",
        ],
        synonyms=["TMT", "HYSD bar", "rebars", "construction bar", "structural bar"],
        keywords=["rebar", "reinforcing", "deformed", "bar", "TMT"],
        excludes=["stainless", "wire rod", "angle"],
    ),
    ClassifierEntry(
        cn_code="7216",
        sector="iron_steel",
        label="Structural sections (beams, channels, angles)",
        phrases=[
            "H beam",
            "I beam",
            "wide flange beam",
            "channel steel",
            "angle steel",
            "structural section",
            "steel angle",
            "steel channel",
            "UB section",
            "UC section",
        ],
        synonyms=["HEA", "HEB", "IPE", "UPN", "UB", "UC", "RSA", "RSC", "steel joist"],
        keywords=["beam", "channel", "angle", "section", "structural", "joist"],
        excludes=["stainless", "tube", "pipe"],
    ),
    ClassifierEntry(
        cn_code="7217",
        sector="iron_steel",
        label="Drawn steel wire",
        phrases=["drawn steel wire", "steel wire", "galvanized wire", "cold drawn wire"],
        synonyms=[],
        keywords=["wire", "drawn wire"],
        excludes=["wire rod", "stainless"],
    ),
    ClassifierEntry(
        cn_code="7219",
        sector="iron_steel",
        label="Stainless steel flat-rolled ≥600 mm",
        phrases=[
            "stainless steel coil",
            "stainless steel sheet",
            "stainless steel plate",
            "stainless flat rolled",
            "austenitic steel sheet",
            "duplex steel sheet",
        ],
        synonyms=[
            "SS coil",
            "SS sheet",
            "304 sheet",
            "316 sheet",
            "321 plate",
            "2205 plate",
        ],
        keywords=["stainless", "austenitic", "duplex", "304", "316", "321", "2205",
                  "ferritic steel sheet"],
    ),
    ClassifierEntry(
        cn_code="7220",
        sector="iron_steel",
        label="Stainless steel flat-rolled <600 mm",
        phrases=[
            "stainless steel strip",
            "stainless narrow strip",
            "stainless slit coil",
        ],
        synonyms=["SS strip", "slitted stainless"],
        keywords=["stainless strip", "narrow stainless"],
        excludes=["sheet", "coil"],
    ),
    ClassifierEntry(
        cn_code="7222",
        sector="iron_steel",
        label="Stainless steel bars and rods",
        phrases=[
            "stainless steel bar",
            "stainless steel rod",
            "stainless round bar",
            "stainless hex bar",
            "stainless flat bar",
        ],
        synonyms=["SS bar", "stainless rod"],
        keywords=["stainless bar", "stainless rod"],
    ),
    ClassifierEntry(
        cn_code="7223",
        sector="iron_steel",
        label="Stainless steel wire",
        phrases=["stainless steel wire", "SS wire"],
        synonyms=[],
        keywords=["stainless wire"],
    ),
    ClassifierEntry(
        cn_code="7304",
        sector="iron_steel",
        label="Seamless steel tubes and pipes",
        phrases=[
            "seamless steel pipe",
            "seamless steel tube",
            "seamless pipe",
            "OCTG pipe",
            "drill pipe",
            "casing pipe",
            "seamless tube",
        ],
        synonyms=["SMLS", "seamless casing", "seamless tubing", "API pipe"],
        keywords=["seamless", "tube", "pipe"],
        excludes=["welded", "ERW", "cast iron"],
    ),
    ClassifierEntry(
        cn_code="7306",
        sector="iron_steel",
        label="Welded steel pipes and tubes",
        phrases=[
            "welded steel pipe",
            "ERW pipe",
            "electric resistance welded pipe",
            "welded tube",
            "HFW pipe",
        ],
        synonyms=["ERW", "LSAW", "HSAW", "SAW pipe", "longitudinal welded"],
        keywords=["welded pipe", "ERW", "welded tube"],
        excludes=["seamless"],
    ),
    ClassifierEntry(
        cn_code="7307",
        sector="iron_steel",
        label="Pipe fittings",
        phrases=[
            "pipe fitting",
            "tube fitting",
            "steel elbow",
            "steel reducer",
            "pipe flange",
            "steel tee",
            "weld neck flange",
            "butt weld fitting",
        ],
        synonyms=["BW fitting", "fittings"],
        keywords=["fitting", "elbow", "flange", "reducer", "tee"],
        excludes=["valve"],
    ),
    ClassifierEntry(
        cn_code="7308",
        sector="iron_steel",
        label="Steel structures and frameworks",
        phrases=[
            "steel structure",
            "structural steel framework",
            "steel frame",
            "prefabricated steel structure",
            "steel building frame",
            "steel bridge",
            "steel tower",
        ],
        synonyms=["structural steelwork", "fabricated steel"],
        keywords=["steel structure", "framework", "steel frame", "prefab steel"],
    ),
    ClassifierEntry(
        cn_code="7318",
        sector="iron_steel",
        label="Steel fasteners (bolts, nuts, screws, washers)",
        phrases=[
            "steel bolt",
            "steel nut",
            "steel screw",
            "steel washer",
            "steel fastener",
            "anchor bolt",
            "hex bolt",
        ],
        synonyms=["fasteners", "nuts and bolts", "threaded fastener"],
        keywords=["bolt", "nut", "screw", "washer", "fastener"],
    ),
    # =========================================================================
    # ALUMINIUM
    # =========================================================================
    ClassifierEntry(
        cn_code="7601",
        sector="aluminium",
        label="Unwrought aluminium (ingot / sow / T-bar)",
        phrases=[
            "aluminium ingot",
            "aluminum ingot",
            "primary aluminium",
            "aluminium billet",
            "aluminium sow",
            "aluminium T-bar",
        ],
        synonyms=["AL ingot", "alum ingot", "P1020", "SHFE aluminium"],
        keywords=["aluminium ingot", "aluminum ingot", "primary aluminium", "unwrought"],
    ),
    ClassifierEntry(
        cn_code="7602",
        sector="aluminium",
        label="Aluminium scrap / dross",
        phrases=["aluminium scrap", "aluminum scrap", "recycled aluminium", "aluminium dross"],
        synonyms=["Al scrap", "UBC", "used beverage can"],
        keywords=["aluminium scrap", "recycled aluminium"],
    ),
    ClassifierEntry(
        cn_code="7604",
        sector="aluminium",
        label="Aluminium profiles / bars / rods / extrusions",
        phrases=[
            "aluminium profile",
            "aluminium extrusion",
            "extruded aluminium",
            "aluminium bar",
            "aluminium rod",
            "aluminium section",
        ],
        synonyms=["Al profile", "aluminium section", "alum extrusion"],
        keywords=["aluminium profile", "extruded", "aluminium bar", "aluminium rod"],
    ),
    ClassifierEntry(
        cn_code="7605",
        sector="aluminium",
        label="Aluminium wire / conductor",
        phrases=[
            "aluminium wire",
            "aluminum wire",
            "AAAC conductor",
            "ACSR conductor",
            "aluminium conductor",
        ],
        synonyms=["Al wire", "alum wire"],
        keywords=["aluminium wire", "aluminum wire"],
    ),
    ClassifierEntry(
        cn_code="7606",
        sector="aluminium",
        label="Aluminium sheets / plates / coil / strip",
        phrases=[
            "aluminium sheet",
            "aluminium plate",
            "aluminium coil",
            "aluminium strip",
            "aluminum sheet",
            "aluminum plate",
        ],
        synonyms=["Al sheet", "Al coil", "alum sheet", "alum plate"],
        keywords=["aluminium sheet", "aluminium plate", "aluminium coil", "aluminum sheet"],
    ),
    ClassifierEntry(
        cn_code="7607",
        sector="aluminium",
        label="Aluminium foil",
        phrases=["aluminium foil", "aluminum foil", "household foil", "alum foil"],
        synonyms=["Al foil"],
        keywords=["aluminium foil", "aluminum foil", "foil"],
    ),
    ClassifierEntry(
        cn_code="7608",
        sector="aluminium",
        label="Aluminium tubes and pipes",
        phrases=[
            "aluminium tube",
            "aluminium pipe",
            "aluminum tube",
            "aluminum pipe",
        ],
        synonyms=["Al tube", "alum tube"],
        keywords=["aluminium tube", "aluminium pipe"],
    ),
    # =========================================================================
    # FERTILISERS
    # =========================================================================
    ClassifierEntry(
        cn_code="28080000",
        sector="fertilisers",
        label="Nitric acid / sulphonitric acids",
        phrases=["nitric acid", "sulphonitric acid", "concentrated nitric acid"],
        synonyms=["HNO3"],
        keywords=["nitric", "acid"],
    ),
    ClassifierEntry(
        cn_code="28141000",
        sector="fertilisers",
        label="Anhydrous ammonia",
        phrases=[
            "anhydrous ammonia",
            "liquid ammonia",
            "ammonia gas",
            "ammonia anhydrous",
        ],
        synonyms=["NH3", "anhydrous NH3"],
        keywords=["ammonia", "anhydrous"],
        excludes=["solution", "aqueous", "ammonium"],
    ),
    ClassifierEntry(
        cn_code="28142000",
        sector="fertilisers",
        label="Ammonia solution / aqueous ammonia",
        phrases=["ammonia solution", "aqueous ammonia", "ammonium hydroxide", "ammonia water"],
        synonyms=["ammonia liquor"],
        keywords=["ammonia solution", "aqueous ammonia"],
        excludes=["anhydrous"],
    ),
    ClassifierEntry(
        cn_code="31021000",
        sector="fertilisers",
        label="Urea fertilizer",
        phrases=[
            "urea fertilizer",
            "prilled urea",
            "granular urea",
            "urea 46",
            "agricultural urea",
        ],
        synonyms=["CO(NH2)2", "urea 46%N"],
        keywords=["urea"],
        excludes=["ammonium", "nitrate", "formaldehyde"],
    ),
    ClassifierEntry(
        cn_code="31023090",
        sector="fertilisers",
        label="Ammonium nitrate",
        phrases=[
            "ammonium nitrate",
            "technical ammonium nitrate",
            "porous prilled ammonium nitrate",
            "AN fertilizer",
        ],
        synonyms=["AN", "PPAN", "LDAN"],
        keywords=["ammonium nitrate"],
        excludes=["calcium", "solution", "UAN"],
    ),
    ClassifierEntry(
        cn_code="31022100",
        sector="fertilisers",
        label="Ammonium sulphate",
        phrases=[
            "ammonium sulphate",
            "ammonium sulfate",
            "sulphate of ammonia",
        ],
        synonyms=["AS", "AMS", "(NH4)2SO4"],
        keywords=["ammonium sulphate", "ammonium sulfate"],
    ),
    ClassifierEntry(
        cn_code="31053000",
        sector="fertilisers",
        label="Diammonium phosphate (DAP)",
        phrases=[
            "diammonium phosphate",
            "DAP fertilizer",
            "di-ammonium phosphate",
        ],
        synonyms=["DAP"],
        keywords=["diammonium", "phosphate"],
        excludes=["MAP", "mono"],
    ),
    ClassifierEntry(
        cn_code="31054000",
        sector="fertilisers",
        label="Monoammonium phosphate (MAP)",
        phrases=[
            "monoammonium phosphate",
            "MAP fertilizer",
            "mono ammonium phosphate",
        ],
        synonyms=["MAP"],
        keywords=["monoammonium", "phosphate"],
        excludes=["DAP", "di-ammonium"],
    ),
    ClassifierEntry(
        cn_code="31052010",
        sector="fertilisers",
        label="NPK compound fertilizer",
        phrases=[
            "NPK fertilizer",
            "compound fertilizer NPK",
            "three element fertilizer",
            "N-P-K fertilizer",
        ],
        synonyms=["NPK", "compound NPK"],
        keywords=["NPK", "nitrogen phosphorus potassium", "compound fertilizer"],
    ),
    ClassifierEntry(
        cn_code="31028000",
        sector="fertilisers",
        label="UAN — urea ammonium nitrate solution",
        phrases=[
            "urea ammonium nitrate",
            "UAN solution",
            "liquid nitrogen fertilizer",
            "UAN 28",
            "UAN 30",
            "UAN 32",
        ],
        synonyms=["UAN", "liquid fertilizer"],
        keywords=["UAN", "urea ammonium nitrate"],
    ),
    # =========================================================================
    # ELECTRICITY
    # =========================================================================
    ClassifierEntry(
        cn_code="27160000",
        sector="electricity",
        label="Electrical energy",
        phrases=[
            "electrical energy",
            "electric power",
            "electricity supply",
            "electric current",
        ],
        synonyms=["power supply", "electricity"],
        keywords=["electricity", "electrical energy", "electric power"],
    ),
    # =========================================================================
    # HYDROGEN
    # =========================================================================
    ClassifierEntry(
        cn_code="28041000",
        sector="hydrogen",
        label="Hydrogen gas",
        phrases=[
            "hydrogen gas",
            "green hydrogen",
            "blue hydrogen",
            "grey hydrogen",
            "electrolytic hydrogen",
            "industrial hydrogen",
        ],
        synonyms=["H2", "compressed hydrogen", "liquid hydrogen"],
        keywords=["hydrogen", "H2"],
    ),
]


# ── Text normalisation ────────────────────────────────────────────────────────

_PUNCT_RE = re.compile(r"[^\w\s\-]", re.UNICODE)
_WHITESPACE_RE = re.compile(r"\s+")


def _normalize_text(text: str) -> str:
    """Lowercase, NFKD-normalize, strip punctuation (except hyphens), collapse spaces."""
    nfkd = unicodedata.normalize("NFKD", text)
    lower = nfkd.lower()
    no_punct = _PUNCT_RE.sub(" ", lower)
    collapsed = _WHITESPACE_RE.sub(" ", no_punct).strip()
    return collapsed


# ── CN code extraction from free text ────────────────────────────────────────

# Match 6-8 consecutive digit sequences (possible CN codes embedded in text).
_CN_CODE_RE = re.compile(r"\b(\d{6,8})\b")


def _extract_cn_code_from_text(description: str) -> str | None:
    """Return the first 6-8 digit sequence that is in CBAM scope, or None."""
    for match in _CN_CODE_RE.finditer(description):
        candidate = match.group(1)
        if is_in_cbam_scope(candidate):
            return candidate
    return None


# ── Per-entry scoring ─────────────────────────────────────────────────────────

_PHRASE_SCORE = 0.92
_SYNONYM_SCORE = 0.78
_KEYWORD_INCREMENT = 0.12
_KEYWORD_CAP = 0.60
_EXCLUDE_PENALTY = 0.5


def _score_entry(entry: ClassifierEntry, norm_description: str) -> float:
    """Compute a [0, 1] confidence score for one ClassifierEntry.

    Scoring steps (see module docstring for full algorithm):
      1. Phrase match  → sets score floor at 0.92
      2. Synonym match → sets score floor at 0.78
      3. Keyword additive → each match adds 0.12, capped at 0.60
      4. final = max(phrase/synonym, keyword_boost)
      5. Each exclude match multiplies final by 0.50
    """
    phrase_syn_score: float = 0.0

    for phrase in entry.phrases:
        if _normalize_text(phrase) in norm_description:
            phrase_syn_score = max(phrase_syn_score, _PHRASE_SCORE)
            break  # short-circuit once we have the top score

    if phrase_syn_score < _PHRASE_SCORE:
        for synonym in entry.synonyms:
            norm_syn = _normalize_text(synonym)
            # Match synonym as a whole word / phrase (padded with word boundaries)
            if re.search(r"(?<!\w)" + re.escape(norm_syn) + r"(?!\w)", norm_description):
                phrase_syn_score = max(phrase_syn_score, _SYNONYM_SCORE)
                break

    keyword_boost: float = 0.0
    for kw in entry.keywords:
        norm_kw = _normalize_text(kw)
        if re.search(r"(?<!\w)" + re.escape(norm_kw) + r"(?!\w)", norm_description):
            keyword_boost = min(keyword_boost + _KEYWORD_INCREMENT, _KEYWORD_CAP)

    final = max(phrase_syn_score, keyword_boost)

    for excl in entry.excludes:
        norm_excl = _normalize_text(excl)
        if re.search(r"(?<!\w)" + re.escape(norm_excl) + r"(?!\w)", norm_description):
            final *= _EXCLUDE_PENALTY

    return final


# ── Keyword classification ────────────────────────────────────────────────────


def _run_keyword_classification(
    norm_description: str,
) -> list[tuple[ClassifierEntry, float]]:
    """Score all entries and return sorted (entry, score) list, best first."""
    scored: list[tuple[ClassifierEntry, float]] = []
    for entry in _CLASSIFIER_TABLE:
        score = _score_entry(entry, norm_description)
        scored.append((entry, score))
    scored.sort(key=lambda t: t[1], reverse=True)
    return scored


def _build_candidates(
    scored: list[tuple[ClassifierEntry, float]],
    method: str,
    top_n: int = 5,
) -> list[dict[str, Any]]:
    return [
        {
            "cn_code": e.cn_code,
            "sector": e.sector,
            "label": e.label,
            "confidence": str(round(s, 4)),
            "method": method,
        }
        for e, s in scored[:top_n]
    ]


# ── LLM fallback ──────────────────────────────────────────────────────────────

_CBAM_SECTORS = [
    "cement",
    "iron_steel",
    "aluminium",
    "fertilisers",
    "electricity",
    "hydrogen",
]

_LLM_SYSTEM_PROMPT = """\
You are a CBAM (Carbon Border Adjustment Mechanism) trade classification \
assistant. Your task is to identify the most appropriate EU Combined \
Nomenclature (CN) code and CBAM sector for a given product description.

The 6 valid CBAM sectors are: cement, iron_steel, aluminium, fertilisers, \
electricity, hydrogen.

You MUST respond with a valid JSON object only — no markdown, no commentary. \
Schema:
{
  "cn_code": "<4 or 8 digit CN code>",
  "sector": "<one of the 6 sectors above>",
  "confidence": <float 0.0–1.0>,
  "reasoning": "<one sentence>"
}
"""


def _call_llm(
    description: str,
    keyword_candidates: list[dict[str, Any]],
    api_key: str,
) -> dict[str, Any] | None:
    """Call Claude (haiku) to classify the description.

    Returns a parsed dict ``{cn_code, sector, confidence, reasoning}`` on
    success, or ``None`` on any error (timeout, parse failure, etc.).
    """
    try:
        import anthropic  # noqa: PLC0415 — intentional lazy import
    except ImportError:
        _logger.warning(
            "anthropic package not installed; skipping LLM fallback for classification"
        )
        return None

    model = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")

    candidate_context = ""
    if keyword_candidates:
        lines = [
            f"  - CN {c['cn_code']} ({c['sector']}): {c['label']} "
            f"[keyword score {c['confidence']}]"
            for c in keyword_candidates
        ]
        candidate_context = (
            "\n\nTop keyword candidates for context (may be incomplete):\n"
            + "\n".join(lines)
        )

    user_message = (
        f"Product description: {description!r}"
        f"{candidate_context}"
        "\n\nRespond with the JSON classification only."
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=model,
            max_tokens=256,
            system=_LLM_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )
        raw_text = response.content[0].text.strip()
        # Strip possible markdown code fence
        raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
        raw_text = re.sub(r"\s*```$", "", raw_text)
        parsed = json.loads(raw_text)

        # Validate required keys
        if not all(k in parsed for k in ("cn_code", "sector", "confidence")):
            _logger.warning("LLM response missing required keys: %s", raw_text)
            return None

        # Validate sector
        if parsed["sector"] not in _CBAM_SECTORS:
            _logger.warning("LLM returned unknown sector %r", parsed["sector"])
            return None

        # Validate confidence is numeric
        parsed["confidence"] = float(parsed["confidence"])
        return parsed

    except (json.JSONDecodeError, KeyError, IndexError, ValueError) as exc:
        _logger.warning("LLM response parse error: %s", exc)
        return None
    except Exception as exc:  # noqa: BLE001 — intentional broad catch for timeout/network
        _logger.warning("LLM call failed: %s", exc)
        return None


# ── Review reason helpers ─────────────────────────────────────────────────────


def _make_review_reason(
    confidence: Decimal,
    method: str,
    description: str,
) -> str | None:
    if confidence < REVIEW_THRESHOLD:
        return (
            f"Very low confidence ({confidence}) — no strong keyword or LLM match found "
            f"for description: {description[:80]!r}"
        )
    if confidence < AUTO_ASSIGN_THRESHOLD:
        return (
            f"Confidence {confidence} is below auto-assign threshold "
            f"({AUTO_ASSIGN_THRESHOLD}); human review recommended."
        )
    return None


# ── Public API ────────────────────────────────────────────────────────────────


def classify_description(
    description: str,
    hint_cn_code: str | None = None,
    llm_fallback: bool = True,
) -> CNClassificationResult:
    """Classify a product description to a CBAM CN code and sector.

    Parameters
    ----------
    description:
        Free-text product description (e.g. from an invoice or declaration).
    hint_cn_code:
        Optional CN code already present in the source document.  If provided
        and in CBAM scope, it is returned directly with ``method="hint"`` and
        ``confidence=0.95`` without any classification pipeline.
    llm_fallback:
        If ``True`` (default) and ``ANTHROPIC_API_KEY`` is set, fall back to
        Claude when keyword confidence is below :data:`LLM_TRIGGER_THRESHOLD`.

    Returns
    -------
    CNClassificationResult
    """
    if not description or not description.strip():
        return CNClassificationResult(
            cn_code="",
            sector="",
            confidence=Decimal("0"),
            method="keyword",
            requires_review=True,
            candidates=[],
            review_reason="Empty description provided.",
        )

    # ── 1. Honour hint CN code ─────────────────────────────────────────────
    if hint_cn_code:
        if is_in_cbam_scope(hint_cn_code):
            sector = lookup_sector(hint_cn_code) or ""
            _logger.debug(
                "classify_description: using hint CN code %r (sector=%s)",
                hint_cn_code,
                sector,
            )
            return CNClassificationResult(
                cn_code=hint_cn_code,
                sector=sector,
                confidence=Decimal("0.95"),
                method="hint",
                requires_review=False,
                candidates=[
                    {
                        "cn_code": hint_cn_code,
                        "sector": sector,
                        "label": "Hint from source document",
                        "confidence": "0.95",
                        "method": "hint",
                    }
                ],
                review_reason=None,
            )
        else:
            _logger.debug(
                "classify_description: hint CN code %r is not in CBAM scope; ignoring",
                hint_cn_code,
            )

    # ── 2. Check for embedded CN code in description text ─────────────────
    embedded_cn = _extract_cn_code_from_text(description)
    if embedded_cn:
        sector = lookup_sector(embedded_cn) or ""
        confidence = Decimal("0.96")
        _logger.debug(
            "classify_description: extracted CN code %r from text (sector=%s)",
            embedded_cn,
            sector,
        )
        return CNClassificationResult(
            cn_code=embedded_cn,
            sector=sector,
            confidence=confidence,
            method="extracted_from_text",
            requires_review=False,
            candidates=[
                {
                    "cn_code": embedded_cn,
                    "sector": sector,
                    "label": "CN code extracted directly from description text",
                    "confidence": str(confidence),
                    "method": "extracted_from_text",
                }
            ],
            review_reason=None,
        )

    # ── 3. Keyword / phrase classification ────────────────────────────────
    norm_description = _normalize_text(description)
    scored = _run_keyword_classification(norm_description)

    best_entry, best_score_f = scored[0] if scored else (None, 0.0)
    keyword_confidence = Decimal(str(round(best_score_f, 4)))
    keyword_candidates = _build_candidates(scored, method="keyword")

    _logger.debug(
        "classify_description: keyword best=%s score=%.4f description=%r",
        best_entry.cn_code if best_entry else "N/A",
        best_score_f,
        description[:80],
    )

    # ── 4. LLM fallback (optional) ─────────────────────────────────────────
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    use_llm = (
        llm_fallback
        and bool(api_key)
        and keyword_confidence < LLM_TRIGGER_THRESHOLD
    )

    if use_llm:
        _logger.info(
            "classify_description: keyword confidence %.4f below LLM threshold; "
            "calling LLM for %r",
            float(keyword_confidence),
            description[:80],
        )
        llm_result = _call_llm(description, keyword_candidates, api_key)

        if llm_result and float(llm_result["confidence"]) >= float(REVIEW_THRESHOLD):
            llm_cn = llm_result["cn_code"]
            llm_sector = llm_result["sector"]
            llm_conf = Decimal(str(round(float(llm_result["confidence"]), 4)))

            # Decide method: if keyword score also contributed, call it "combined"
            method = "combined" if keyword_confidence > Decimal("0") else "llm"

            # Use the higher of keyword and LLM confidence as final confidence
            final_confidence = max(keyword_confidence, llm_conf)

            _logger.info(
                "classify_description: LLM returned CN=%s sector=%s conf=%.4f",
                llm_cn,
                llm_sector,
                float(llm_conf),
            )

            requires_review = final_confidence < AUTO_ASSIGN_THRESHOLD
            review_reason = _make_review_reason(final_confidence, method, description)

            # Merge LLM result into candidates list
            llm_candidate = {
                "cn_code": llm_cn,
                "sector": llm_sector,
                "label": llm_result.get("reasoning", "LLM classification"),
                "confidence": str(final_confidence),
                "method": method,
            }
            candidates = [llm_candidate] + [
                c for c in keyword_candidates if c["cn_code"] != llm_cn
            ][:4]

            return CNClassificationResult(
                cn_code=llm_cn,
                sector=llm_sector,
                confidence=final_confidence,
                method=method,
                requires_review=requires_review,
                candidates=candidates,
                review_reason=review_reason,
            )
        else:
            _logger.warning(
                "classify_description: LLM result rejected (low confidence or error); "
                "falling back to keyword result"
            )

    # ── 5. Return keyword result ───────────────────────────────────────────
    if best_entry is None or keyword_confidence == Decimal("0"):
        # No match at all
        return CNClassificationResult(
            cn_code="",
            sector="",
            confidence=Decimal("0"),
            method="keyword",
            requires_review=True,
            candidates=keyword_candidates,
            review_reason=(
                "No keyword, synonym or phrase matched the description. "
                "Manual classification required."
            ),
        )

    requires_review = keyword_confidence < AUTO_ASSIGN_THRESHOLD
    review_reason = _make_review_reason(keyword_confidence, "keyword", description)

    return CNClassificationResult(
        cn_code=best_entry.cn_code,
        sector=best_entry.sector,
        confidence=keyword_confidence,
        method="keyword",
        requires_review=requires_review,
        candidates=keyword_candidates,
        review_reason=review_reason,
    )


# ── Public re-exports ─────────────────────────────────────────────────────────

__all__ = [
    "AUTO_ASSIGN_THRESHOLD",
    "LLM_TRIGGER_THRESHOLD",
    "REVIEW_THRESHOLD",
    "ClassifierEntry",
    "CNClassificationResult",
    "classify_description",
]
