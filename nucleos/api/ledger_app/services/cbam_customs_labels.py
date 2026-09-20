"""Reading a declaration by its labels, when the labels are not what we expect.

The patterns in cbam_customs_parser are English and exact, which is right for
the forms they were written from and useless for the two ways a real document
departs from them: it is in another language, or it was scanned badly enough
that "Commodity" arrived as "Comrnodity". In both cases the label is close to
one we know and the value beside it is perfectly good.

So the label is matched by closeness and the value is not. Tolerance on the
label recovers a document; tolerance on a value would invent data. Every value
here must prove it can be the thing its label claims, and is dropped otherwise —
a missing field is visible to a reviewer, a wrong one is not.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

# What each field is called, across the languages a UK importer's paperwork
# arrives in. Spelling variants are unnecessary — closeness handles those — but
# a different word is a different word.
LABELS: dict[str, tuple[str, ...]] = {
    "cn_code": (
        "commodity code", "cn code", "tariff code", "hs code", "goods code",
        "warennummer", "zolltarifnummer",          # de
        "code marchandise", "code des marchandises", "nomenclature",  # fr
        "goederencode",                             # nl
        "codice merce",                             # it
        "codigo de mercancia",                      # es
    ),
    "net_mass": (
        "net mass", "net weight", "nett mass", "nett weight",
        "eigenmasse", "nettomasse", "nettogewicht",  # de
        "masse nette", "poids net",                  # fr
        "nettogewicht",                              # nl
        "massa netta",                               # it
        "masa neta",                                 # es
    ),
    "origin_country": (
        "country of origin", "origin country", "origin",
        "ursprungsland",                             # de
        "pays d origine", "pays d'origine",          # fr
        "land van oorsprong",                        # nl
        "paese di origine",                          # it
        "pais de origen",                            # es
    ),
    "importer_eori": (
        "importer eori", "consignee eori", "declarant eori", "eori number", "eori",
        "eori nummer", "eori-nummer",                # de
        "numero eori",                               # fr
    ),
    "entry_reference": (
        "movement reference number", "declaration reference", "entry reference", "mrn",
        "bezugsnummer",                              # de
        "numero de reference",                       # fr
    ),
}

# A label match this close is the same label differently spelled or badly
# scanned. Below it, it is a different label and guessing would be invention.
SIMILARITY_THRESHOLD = 0.82

_SEPARATOR = re.compile(r"[:–—]|\s{2,}")
_NOISE = re.compile(r"[^a-z0-9 ]+")
# "Commodity code (CN)", "Net mass (kg)": the bracket restates the format or the
# unit. Kept in, it counts against the match — "commodity code cn" scores 0.79
# against "commodity code" where the label alone scores 0.90.
_PARENTHETICAL = re.compile(r"\([^)]*\)")


def _normalise(text: str) -> str:
    return _NOISE.sub(" ", _PARENTHETICAL.sub(" ", text).lower()).strip()


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def _split_label_and_value(line: str) -> tuple[str, str]:
    """A line as a label and whatever follows it on the same line."""
    m = _SEPARATOR.search(line)
    if m:
        return line[:m.start()], line[m.end():]
    # No separator: the label may be the opening words, e.g. "Net mass 24 500 kg".
    words = line.split()
    for take in (3, 2, 1):
        if len(words) > take:
            return " ".join(words[:take]), " ".join(words[take:])
    return line, ""


def _field_for(label: str) -> tuple[str | None, float]:
    normalised = _normalise(label)
    if not normalised:
        return None, 0.0
    best_field, best_score = None, 0.0
    for field, names in LABELS.items():
        for name in names:
            score = _similarity(normalised, name)
            if score > best_score:
                best_field, best_score = field, score
    return (best_field, best_score) if best_score >= SIMILARITY_THRESHOLD else (None, best_score)


def labelled_values(text: str) -> dict[str, list[str]]:
    """Every value whose label resembles one we know, by field, in page order.

    The value is taken from the rest of the label's line, or from the line below
    when the label stands alone — the two ways a form prints one.
    """
    found: dict[str, list[str]] = {}
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if not line.strip():
            continue
        label, inline_value = _split_label_and_value(line)
        field, _ = _field_for(label)
        if not field:
            continue
        value = inline_value.strip()
        if not value and index + 1 < len(lines):
            value = lines[index + 1].strip()
        if value:
            found.setdefault(field, []).append(value)
    return found


def recognised_field_count(text: str) -> int:
    """How many distinct declaration fields this document appears to label."""
    return len(labelled_values(text))


def as_cn_code(value: str) -> str | None:
    digits = re.sub(r"\D", "", value)
    return digits[:8] if len(digits) >= 8 else None


def as_country(value: str) -> str | None:
    m = re.match(r"\s*([A-Za-z]{2})\b(?![A-Za-z])", value)
    return m.group(1).upper() if m else None


def as_eori(value: str, countries: str) -> str | None:
    m = re.match(rf"\s*((?:{countries})\s?[0-9](?:[0-9 ]{{3,16}}[0-9])?)", value, re.I)
    return m.group(1).replace(" ", "").upper() if m else None


def as_mass_kg(value: str, well_formed: re.Pattern[str], parse_quantity: Any) -> float | None:
    m = re.match(r"\s*([0-9][0-9.,\s]*[0-9]|[0-9])", value)
    if not m or not well_formed.fullmatch(m.group(1).strip()):
        return None
    return parse_quantity(m.group(1).strip())[0]
