"""CBAM Customs MRN — EU Movement Reference Number Validation.

Validates the ``entry_reference`` field against the 18-character EU MRN
format required by the Union Customs Code.  A well-formed MRN is the key
that allows customs authorities and CBAM verifiers to cross-reference a
CBAM quarterly report against the underlying customs declaration (SAD / H1).

MRN format (18 characters)
---------------------------
  Positions 1–2  : 2-digit calendar year  (e.g. ``24`` for 2024)
  Positions 3–4  : 2-letter EU member-state code  (e.g. ``GB``, ``DE``, ``FR``)
  Positions 5–17 : 13 alphanumeric characters  (unique declaration reference)
  Position 18    : 1-digit check character

Example of a valid MRN: ``24GB123456789000A1``

Regulation references
---------------------
EU Regulation No 952/2013 (Union Customs Code), Article 5(10)
Commission Delegated Regulation (EU) 2015/2446, Annex B — Data requirements
Commission Implementing Regulation (EU) 2015/2447, Annex B-01 — MRN structure
EU Regulation 2023/956 Art. 35 — quarterly CBAM report content
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


# ── MRN format constants ──────────────────────────────────────────────────────

MRN_LENGTH = 18

# YY (2 digits) + CC (2 letters) + 13 alphanumeric + 1 check digit
_MRN_RE = re.compile(r"^[0-9]{2}[A-Z]{2}[A-Z0-9]{13}[0-9]$")

MRN_REGULATION_REF = (
    "EU Regulation 952/2013 (UCC) Art. 5(10); "
    "Commission Delegated Reg. (EU) 2015/2446 Annex B; "
    "Commission Implementing Reg. (EU) 2015/2447 Annex B-01"
)


# ── Result type ───────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class MRNValidationResult:
    """Outcome of MRN format validation for a single entry_reference value.

    Attributes
    ----------
    entry_reference : str | None
        The original, unmodified value supplied by the caller.
    normalised : str | None
        The stripped and upper-cased form used for pattern matching.
        None when ``entry_reference`` is absent or blank.
    is_valid : bool
        True only when the value is present and matches the EU MRN pattern.
    missing : bool
        True when ``entry_reference`` is absent or blank.
    format_invalid : bool
        True when ``entry_reference`` is present but does not match the pattern.
    regulation_ref : str
        Regulatory citation for the MRN format requirement.
    """

    entry_reference: str | None
    normalised: str | None
    is_valid: bool
    missing: bool
    format_invalid: bool
    regulation_ref: str = field(default=MRN_REGULATION_REF)


# ── Public API ────────────────────────────────────────────────────────────────

def validate_mrn(entry_reference: str | None) -> MRNValidationResult:
    """Validate *entry_reference* against the EU 18-character MRN format.

    Parameters
    ----------
    entry_reference:
        The raw ``entry_reference`` string from the CBAM shipment record.
        None or blank strings are treated as missing.

    Returns
    -------
    MRNValidationResult
        ``is_valid`` is True only when the value is present and matches
        ``^[0-9]{2}[A-Z]{2}[A-Z0-9]{13}[0-9]$``.
    """
    if not entry_reference or not entry_reference.strip():
        return MRNValidationResult(
            entry_reference=entry_reference,
            normalised=None,
            is_valid=False,
            missing=True,
            format_invalid=False,
        )

    normalised = entry_reference.strip().upper()
    format_ok = bool(_MRN_RE.match(normalised))

    return MRNValidationResult(
        entry_reference=entry_reference,
        normalised=normalised,
        is_valid=format_ok,
        missing=False,
        format_invalid=not format_ok,
    )
