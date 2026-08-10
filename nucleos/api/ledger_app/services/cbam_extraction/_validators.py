"""Field validators and normalisers for CBAM document extraction.

Deterministic-first: every extracted value is validated against format rules
before being accepted. Invalid values are cleared and flagged, never silently
kept.
"""
from __future__ import annotations

import datetime
import re
from typing import Any, Callable


import re

# Separators that group thousands but never mark a decimal.
_GROUPING_WHITESPACE = re.compile(r"[\s  ]")


def parse_quantity(text: str | None) -> tuple[float | None, bool]:
    """Parse a quantity written in either separator convention.

    Returns ``(value, ambiguous)``.

    Trade documents use both conventions, frequently in the same corpus, so
    neither can simply be preferred. The rule is that the rightmost separator
    which could be a decimal point is the decimal point:

        24,500.00  ->  24500.0    dot is rightmost, comma groups thousands
        24.500,00  ->  24500.0    comma is rightmost, dot groups thousands
        24,5       ->  24.5       lone comma, not a thousands group
        1,234,567  ->  1234567.0  a decimal point cannot repeat

    One case is genuinely undecidable: a lone separator followed by exactly
    three digits. "24,500" is 24500 in the UK and 24.5 in Germany, and nothing
    in the number itself resolves it. It is read as a thousands separator —
    the dominant convention on commercial invoices and customs declarations —
    and returned with ``ambiguous=True`` so the caller can say so rather than
    present a guess as a reading.
    """
    if text is None:
        return None, False

    cleaned = _GROUPING_WHITESPACE.sub("", str(text)).strip()
    if not cleaned:
        return None, False

    # A leading sign is kept; everything else must be digits or separators.
    if not re.fullmatch(r"[+-]?[0-9][0-9.,]*", cleaned):
        return None, False

    has_comma = "," in cleaned
    has_dot = "." in cleaned
    ambiguous = False

    if has_comma and has_dot:
        # The rightmost separator is the decimal point; the other groups.
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif has_comma or has_dot:
        sep = "," if has_comma else "."
        parts = cleaned.split(sep)
        if len(parts) > 2:
            # Repeated separator can only be grouping.
            cleaned = cleaned.replace(sep, "")
        elif len(parts[1]) == 3 and parts[0]:
            # Undecidable. Read as grouping, and say that it was undecidable.
            cleaned = cleaned.replace(sep, "")
            ambiguous = True
        else:
            cleaned = cleaned.replace(sep, ".")

    try:
        return float(cleaned), ambiguous
    except ValueError:
        return None, False


def _parse_number(text: str | None) -> float | None:
    """Backwards-compatible wrapper: the value only.

    Callers that need to know a reading was undecidable use parse_quantity.
    """
    return parse_quantity(text)[0]


def _normalize_method(value: str | None) -> str | None:
    if not value:
        return None
    lowered = value.strip().lower().replace("_", " ").replace("-", " ")
    if "actual" in lowered:
        return "actual"
    if "estimated" in lowered or "estimate" in lowered:
        return "estimated"
    if "default" in lowered:
        return "default"
    return None


# ── Field validators ──────────────────────────────────────────────────────────

_INCOTERM_WHITELIST: frozenset[str] = frozenset(
    {"EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"}
)


def _valid_incoterm(v: Any) -> bool:
    return isinstance(v, str) and v.strip().upper() in _INCOTERM_WHITELIST


def _valid_iso2(v: Any) -> bool:
    return isinstance(v, str) and bool(re.fullmatch(r"[A-Z]{2}", v.strip()))


def _valid_eori(v: Any) -> bool:
    return isinstance(v, str) and bool(re.fullmatch(r"[A-Z]{2}\d{6,}", v.strip()))


def _valid_cn_code(v: Any) -> bool:
    return isinstance(v, str) and bool(re.fullmatch(r"\d{6,8}", v.strip()))


def _valid_mass(v: Any) -> bool:
    try:
        return float(v) > 0
    except (TypeError, ValueError):
        return False


def _valid_date(v: Any) -> bool:
    if not isinstance(v, str):
        return False
    s = v.strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return False
    try:
        datetime.date.fromisoformat(s)
        return True
    except ValueError:
        return False


_FIELD_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "incoterm": _valid_incoterm,
    "origin_country": _valid_iso2,
    "importer_eori": _valid_eori,
    "cn_code": _valid_cn_code,
    "invoice_date": _valid_date,
}

_FIELD_VALIDATOR_REASONS: dict[str, str] = {
    "incoterm": "not in Incoterms 2020 whitelist",
    "origin_country": "not a valid ISO-3166-1 alpha-2 code",
    "importer_eori": r"does not match EORI format [A-Z]{2}\d{6,}",
    "cn_code": "not a 6-8 digit numeric CN code",
    "invoice_date": "not a valid YYYY-MM-DD date",
}


def _validate_deterministic_fields(
    structured: dict[str, Any],
    flags: list[dict[str, Any]],
) -> None:
    """Validate regex-extracted fields in-place; clear invalids and record flags."""
    for field, validator in _FIELD_VALIDATORS.items():
        val = structured.get(field)
        if val is not None and not validator(val):
            flags.append(
                {
                    "field": field,
                    "issue": "deterministic_validation_failed",
                    "value": val,
                    "reason": _FIELD_VALIDATOR_REASONS[field],
                    "source": "regex",
                }
            )
            structured[field] = None

    mass = structured.get("net_mass_kg")
    if mass is not None and not _valid_mass(mass):
        flags.append(
            {
                "field": "net_mass_kg",
                "issue": "deterministic_validation_failed",
                "value": mass,
                "reason": "not a positive numeric mass",
                "source": "regex",
            }
        )
        structured["net_mass_kg"] = None


def _value_in_text(value: Any, text: str) -> bool:
    """Return True if *value* appears in *text* (case-insensitive).

    Also checks a whitespace-collapsed form of both needle and haystack so
    that OCR-injected spaces (e.g. "720 612" for CN code "720612") do not
    cause valid Claude values to be rejected.
    """
    if value is None:
        return False
    s = str(value).strip()
    if not s:
        return False
    if re.search(re.escape(s), text, flags=re.IGNORECASE):
        return True
    norm_s = re.sub(r"\s+", "", s)
    norm_text = re.sub(r"\s+", "", text)
    if norm_s and re.search(re.escape(norm_s), norm_text, flags=re.IGNORECASE):
        return True
    try:
        f = float(value)
        if f == int(f):
            return bool(re.search(re.escape(str(int(f))), text, flags=re.IGNORECASE))
    except (TypeError, ValueError):
        pass
    return False
