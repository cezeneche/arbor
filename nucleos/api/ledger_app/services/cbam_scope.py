"""
CBAM Scope Determination

Determines whether a CBAM declaration is required for a given importation.

Regulation references
---------------------
EU Regulation 2023/956 (CBAM framework):
  - Article 2(1)  — CBAM applies to goods listed in Annex I imported from third countries
  - Article 2(2)  — Exclusions: goods from countries/territories listed in Annex II
  - Article 2(3)  — De minimis: consignments with intrinsic value ≤ EUR 150 are excluded
  - Article 2(4)  — Goods in transit or temporary admission are excluded
  - Article 3(16) — 'Authorised CBAM Declarant': importer registered with national authority
  - Article 5     — Authorisation to file CBAM declarations (required from 2026)
  - Annex I       — Covered goods and CN codes (six sectors)
  - Annex II      — Countries/territories excluded from CBAM scope (EEA + linked ETS)

Determination outcomes
----------------------
in_scope        All checks passed; a CBAM declaration is required.
out_of_scope    One or more definitive exclusions apply (Annex I, Annex II, de minimis).
requires_review Annex I code is covered but a condition cannot be resolved without
                additional information (e.g. missing origin, EORI format invalid,
                customs procedure unclear).

Public API
----------
determine_cbam_scope(cn_code, origin_country, ...) -> ScopeDetermination
ScopeDetermination                                  — result dataclass
ScopeStatus                                         — enum: IN_SCOPE / OUT_OF_SCOPE / REQUIRES_REVIEW
DE_MINIMIS_THRESHOLD_EUR                            — Decimal("150")
ANNEX_II_COUNTRIES                                  — frozenset of excluded ISO-2 codes
EU_MEMBER_STATES                                    — frozenset of EU-27 ISO-2 codes
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum

from ledger_app.services.cbam_taric import is_in_cbam_scope, lookup_sector

__all__ = [
    "ScopeStatus",
    "ScopeDetermination",
    "DeclarantValidationResult",
    "determine_cbam_scope",
    "validate_declarant_registration",
    "DE_MINIMIS_THRESHOLD_EUR",
    "ANNEX_II_COUNTRIES",
    "EU_MEMBER_STATES",
]

_logger = logging.getLogger("ledger.cbam_scope")

# ── Constants ─────────────────────────────────────────────────────────────────

DE_MINIMIS_THRESHOLD_EUR: Decimal = Decimal("150")
"""Intrinsic-value threshold below which CBAM does not apply (Art. 2(3))."""

# EU-27 member states (not third countries; CBAM never applies to domestic origin)
EU_MEMBER_STATES: frozenset[str] = frozenset({
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
    "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
    "NL", "PL", "PT", "RO", "SE", "SI", "SK",
})

# Annex II territories: excluded from CBAM because they operate within the EU ETS
# or an equivalent carbon pricing system recognised by the Commission.
# Source: EU 2023/956, Annex II (OJ L 130, 16.5.2023, p. 102).
ANNEX_II_COUNTRIES: frozenset[str] = frozenset({
    "IS",  # Iceland — EEA, EU ETS participant
    "LI",  # Liechtenstein — EEA, EU ETS participant
    "NO",  # Norway — EEA, EU ETS participant
    "CH",  # Switzerland — ETS formally linked to EU ETS (Art. 2(2)(b))
})

# EORI format: 2-letter ISO country code (EU member state) + 1–15 alphanumeric chars.
# Non-EU importers use an EU representative's EORI; format remains the same.
_EORI_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{1,15}$")


# ── Result types ──────────────────────────────────────────────────────────────

class ScopeStatus(str, Enum):
    IN_SCOPE = "in_scope"
    OUT_OF_SCOPE = "out_of_scope"
    REQUIRES_REVIEW = "requires_review"


@dataclass(frozen=True)
class ScopeDetermination:
    """Result of a CBAM scope determination check.

    Attributes
    ----------
    status : ScopeStatus
        Overall determination: in_scope, out_of_scope, or requires_review.
    sector : str | None
        CBAM sector from Annex I if the CN code is covered, otherwise None.
    reasons : list[str]
        Structured reason codes explaining the determination.
        Format: ``<rule_ref>:<detail>``
    regulation_refs : list[str]
        Regulation citations relevant to this determination.
    cn_code : str
        Input CN code (normalised, digits only).
    origin_country : str | None
        Input origin country (upper-cased ISO 3166-1 alpha-2).
    consignment_value_eur : Decimal | None
        Input consignment value (intrinsic value, EUR).
    importer_eori : str | None
        Input importer EORI (upper-cased).
    """
    status: ScopeStatus
    sector: str | None
    reasons: list[str]
    regulation_refs: list[str]
    cn_code: str
    origin_country: str | None
    consignment_value_eur: Decimal | None
    importer_eori: str | None


# ── Authorised Declarant validation (EU 2023/956 Art. 5) ─────────────────────

def _load_declarant_allowlist() -> frozenset[str]:
    """Return frozenset of authorised declarant EORIs from env, or empty set."""
    raw = os.getenv("CBAM_AUTHORISED_DECLARANTS", "")
    if not raw.strip():
        return frozenset()
    return frozenset(item.strip().upper() for item in raw.split(",") if item.strip())


@dataclass(frozen=True)
class DeclarantValidationResult:
    """Result of authorised-declarant registration check.

    Attributes
    ----------
    is_valid : bool
        True if all applicable checks pass.
    warnings : list[str]
        Non-blocking issues — should be reviewed before submission.
    regulation_ref : str
        Regulation citation.
    """
    is_valid: bool
    warnings: list[str] = field(default_factory=list)
    regulation_ref: str = "EU Regulation 2023/956, Article 5"


def validate_declarant_registration(
    eori: str | None,
    *,
    allowlist: frozenset[str] | None = None,
) -> DeclarantValidationResult:
    """Validate that an importer EORI is registered as an Authorised CBAM Declarant.

    Three layers of validation (mirrors cbam_installation_registry pattern):

    1. Presence  — EORI must not be blank.
    2. Format    — Must match EU EORI regex (2-letter country + 1–15 alphanumeric).
    3. Allowlist — Optional env var ``CBAM_AUTHORISED_DECLARANTS`` (comma-separated).
    4. Hook      — Optional env var ``CBAM_DECLARANT_REGISTRY_URL`` for future live API.

    Parameters
    ----------
    eori:
        The importer EORI to validate (may be None).
    allowlist:
        Optional frozenset of known valid EORIs.  When None, loaded from env.
        Pass an empty frozenset to disable allowlist checking.
    """
    warnings: list[str] = []

    # Layer 1: Presence
    if not eori or not str(eori).strip():
        return DeclarantValidationResult(
            is_valid=False,
            warnings=["eori_missing — EORI is required for Authorised CBAM Declarant check"],
        )

    norm = str(eori).strip().upper()

    # Layer 2: Format
    if not _EORI_RE.match(norm):
        warnings.append(
            f"eori_format_invalid:{norm!r} — does not match EU EORI format "
            "(2-letter country code + up to 15 alphanumeric chars)"
        )

    # Layer 3: Allowlist
    effective_allowlist = allowlist if allowlist is not None else _load_declarant_allowlist()
    if effective_allowlist and norm not in effective_allowlist:
        warnings.append(
            f"eori_not_in_authorised_list:{norm!r} — "
            "not found in CBAM_AUTHORISED_DECLARANTS; "
            "verify registration with national CBAM competent authority "
            "(EU 2023/956, Art. 5)"
        )

    # Layer 4: Live registry hook (optional)
    registry_url = (os.getenv("CBAM_DECLARANT_REGISTRY_URL") or "").strip()
    if registry_url and norm:
        try:
            import httpx  # lazy import — only needed when URL is configured
            resp = httpx.get(f"{registry_url}/declarants/{norm}", timeout=2.0)
            if resp.status_code == 404:
                warnings.append(
                    f"eori_not_in_registry:{norm!r} — "
                    "declarant not found in remote registry"
                )
            elif resp.status_code != 200:
                _logger.warning(
                    "declarant_registry_check_failed eori=%s status=%s",
                    norm,
                    resp.status_code,
                )
        except Exception as exc:
            _logger.warning("declarant_registry_unreachable: %s", exc)

    return DeclarantValidationResult(is_valid=not warnings, warnings=warnings)


# ── Public function ───────────────────────────────────────────────────────────

def determine_cbam_scope(
    cn_code: str,
    origin_country: str | None = None,
    consignment_value_eur: Decimal | None = None,
    importer_eori: str | None = None,
) -> ScopeDetermination:
    """Determine whether CBAM applies to a given importation.

    Parameters
    ----------
    cn_code:
        EU Combined Nomenclature code of the imported goods (any format;
        non-digit characters are stripped before lookup).
    origin_country:
        ISO 3166-1 alpha-2 code of the country of origin.  Case-insensitive.
        None → cannot determine origin → triggers requires_review.
    consignment_value_eur:
        Intrinsic value of the consignment in EUR (excluding transport/insurance
        costs). None → de minimis check is skipped.
    importer_eori:
        EU Economic Operators Registration and Identification number of the
        importer or their customs representative.  None → triggers requires_review.

    Returns
    -------
    ScopeDetermination
    """
    reasons: list[str] = []
    reg_refs: list[str] = []
    out_of_scope_definitive = False
    requires_review = False

    # Normalise inputs
    norm_cn = "".join(ch for ch in cn_code if ch.isdigit())
    norm_origin = origin_country.strip().upper() if origin_country else None
    norm_eori = importer_eori.strip().upper() if importer_eori else None

    # ── Step 1: Annex I — is the CN code covered? ─────────────────────────────
    sector = lookup_sector(norm_cn)
    if sector is None:
        reasons.append(
            f"annex_i:not_covered:{norm_cn} — "
            f"CN code is not listed in CBAM Annex I (EU 2023/956, Annex I)"
        )
        reg_refs.append("EU Regulation 2023/956, Annex I (covered goods and CN codes)")
        out_of_scope_definitive = True
    else:
        reasons.append(
            f"annex_i:covered:{norm_cn}:sector={sector} — "
            f"CN code is covered by CBAM Annex I (EU 2023/956, Annex I)"
        )
        reg_refs.append("EU Regulation 2023/956, Annex I (covered goods and CN codes)")

    # ── Step 2: Origin country — EU member state or Annex II territory? ───────
    if norm_origin is None:
        reasons.append(
            "origin:missing — origin country not provided; "
            "cannot confirm Annex II exclusion or third-country status"
        )
        requires_review = True
    elif norm_origin in EU_MEMBER_STATES:
        reasons.append(
            f"origin:eu_member_state:{norm_origin} — "
            f"goods originating in an EU member state are not third-country imports; "
            f"CBAM does not apply (EU 2023/956, Art. 2(1))"
        )
        reg_refs.append("EU Regulation 2023/956, Article 2(1) (third-country origin required)")
        out_of_scope_definitive = True
    elif norm_origin in ANNEX_II_COUNTRIES:
        reasons.append(
            f"origin:annex_ii:{norm_origin} — "
            f"country is listed in CBAM Annex II (EEA/linked ETS); "
            f"CBAM does not apply (EU 2023/956, Art. 2(2))"
        )
        reg_refs.append("EU Regulation 2023/956, Article 2(2) and Annex II (excluded territories)")
        out_of_scope_definitive = True
    else:
        reasons.append(
            f"origin:third_country:{norm_origin} — "
            f"third-country origin; CBAM applies unless another exclusion applies"
        )

    # ── Step 3: De minimis — intrinsic value ≤ EUR 150? ──────────────────────
    if consignment_value_eur is not None:
        value = Decimal(str(consignment_value_eur))
        if value <= DE_MINIMIS_THRESHOLD_EUR:
            reasons.append(
                f"de_minimis:below_threshold:{value}EUR — "
                f"intrinsic value ≤ EUR {DE_MINIMIS_THRESHOLD_EUR}; "
                f"CBAM does not apply (EU 2023/956, Art. 2(3))"
            )
            reg_refs.append(
                "EU Regulation 2023/956, Article 2(3) "
                f"(de minimis threshold EUR {DE_MINIMIS_THRESHOLD_EUR})"
            )
            out_of_scope_definitive = True
        else:
            reasons.append(
                f"de_minimis:above_threshold:{value}EUR — "
                f"intrinsic value > EUR {DE_MINIMIS_THRESHOLD_EUR}; "
                f"de minimis exclusion does not apply"
            )
    else:
        reasons.append(
            "de_minimis:value_not_provided — "
            "consignment value not provided; de minimis check skipped"
        )

    # ── Step 4: Importer EORI validation ─────────────────────────────────────
    if norm_eori is None:
        reasons.append(
            "eori:missing — importer EORI not provided; "
            "required to identify the Authorised CBAM Declarant "
            "(EU 2023/956, Art. 3(16) and Art. 5)"
        )
        reg_refs.append(
            "EU Regulation 2023/956, Article 5 "
            "(authorisation as CBAM Declarant required from 2026)"
        )
        requires_review = True
    elif not _EORI_RE.match(norm_eori):
        reasons.append(
            f"eori:format_invalid:{norm_eori!r} — "
            f"does not match EU EORI format "
            f"(2-letter country code + up to 15 alphanumeric chars); "
            f"verify with the national customs authority"
        )
        requires_review = True
    else:
        reasons.append(
            f"eori:format_valid:{norm_eori} — "
            f"EORI matches expected format; "
            f"registration status must be verified with DG TAXUD registry"
        )

    # ── Step 5: Authorised Declarant check (Art. 5) ───────────────────────────
    if norm_eori and _EORI_RE.match(norm_eori):
        declarant_result = validate_declarant_registration(norm_eori)
        for w in declarant_result.warnings:
            reasons.append(f"art5:{w}")
            if "not_in_authorised_list" in w or "not_in_registry" in w:
                requires_review = True
        reg_refs.append(declarant_result.regulation_ref)

    # ── Final determination ───────────────────────────────────────────────────
    if out_of_scope_definitive:
        final_status = ScopeStatus.OUT_OF_SCOPE
    elif requires_review:
        final_status = ScopeStatus.REQUIRES_REVIEW
    else:
        final_status = ScopeStatus.IN_SCOPE
        reg_refs.append(
            "EU Regulation 2023/956, Article 2(1) (CBAM obligation confirmed)"
        )

    # Deduplicate refs while preserving order
    seen: set[str] = set()
    unique_refs = [r for r in reg_refs if not (r in seen or seen.add(r))]  # type: ignore[func-returns-value]

    return ScopeDetermination(
        status=final_status,
        sector=sector,
        reasons=reasons,
        regulation_refs=unique_refs,
        cn_code=norm_cn,
        origin_country=norm_origin,
        consignment_value_eur=(
            Decimal(str(consignment_value_eur)) if consignment_value_eur is not None else None
        ),
        importer_eori=norm_eori,
    )
