"""Field validators and normalisers for CBAM document extraction.

Deterministic-first: every extracted value is validated against format rules
before being accepted. Invalid values are cleared and flagged, never silently
kept.
"""
from __future__ import annotations

import datetime
import re
from typing import Any, Callable


def _parse_number(text: str | None) -> float | None:
    if text is None:
        return None
    cleaned = text.replace(",", "").strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


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
