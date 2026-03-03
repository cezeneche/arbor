"""
CBAM Installation Registry Validation

Source: EU Regulation 2023/956, Article 10
    'Where actual embedded emissions are used, the CBAM declaration shall include
    the identifier of the installation as registered in the CBAM Transitional
    Registry (Implementing Regulation (EU) 2023/1773, Article 5).'

The DG TAXUD CBAM Transitional Registry requires authentication for live queries.
This module implements three layers of validation that can run offline:

1. **Presence check** — installation_id is mandatory for method="actual".
   Absence is a blocking data-quality issue (missing, not just a warning).

2. **Format check** — EU CBAM installations are identified by their EU ETS EUTL
   installation identifier.  The canonical format is:
       {ISO-3166-1 alpha-2 country code} + alphanumeric/dash/underscore suffix
       minimum total length: 4 characters
   Examples: DE_12345678, FR-OP-001, GB_TL_123456, IN_CPCB_A001
   A non-conforming ID is flagged as a warning (not blocking) because third-country
   installation ID formats vary; the importer must verify against the registry.

3. **Allowlist check** (optional) — operators can supply a comma-separated list of
   known installation IDs via the ``CBAM_KNOWN_INSTALLATION_IDS`` environment
   variable.  When the allowlist is non-empty, any ID absent from it produces a
   warning, enabling pre-production testing against a fixed set of installations.

Severity matrix (EU 2023/956 Art. 10):
    method="actual", installation_id absent          → BLOCKING (missing)
    method="actual", installation_id wrong format    → WARNING
    method="actual", not in non-empty allowlist      → WARNING
    method != "actual"                               → no registry checks applied
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

__all__ = [
    "InstallationValidationResult",
    "validate_installation_id",
    "INSTALLATION_ID_RE",
]

# EU ETS EUTL installation ID pattern:
# - Starts with exactly 2 uppercase letters (ISO country code)
# - Followed by 2 or more alphanumeric characters, dashes, or underscores
# - Total minimum length 4 characters (2-char country + at least 2 more)
INSTALLATION_ID_RE = re.compile(r"^[A-Z]{2}[\w\-]{2,}$")


def _load_allowlist() -> frozenset[str]:
    """Return frozenset of known installation IDs from env, or empty set."""
    raw = os.getenv("CBAM_KNOWN_INSTALLATION_IDS", "")
    if not raw.strip():
        return frozenset()
    return frozenset(item.strip() for item in raw.split(",") if item.strip())


@dataclass(frozen=True)
class InstallationValidationResult:
    """Result of installation ID validation for one goods line.

    Attributes
    ----------
    is_valid : bool
        True if the ID passes all applicable checks (or method != "actual").
    missing : list[str]
        Blocking issues — must be resolved before the declaration is complete.
    warnings : list[str]
        Non-blocking issues — should be reviewed but don't block submission.
    """
    is_valid: bool
    missing: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def validate_installation_id(
    installation_id: str | None,
    method: str,
    goods_line_id: str = "",
    *,
    allowlist: frozenset[str] | None = None,
) -> InstallationValidationResult:
    """Validate ``installation_id`` for a goods line.

    Parameters
    ----------
    installation_id:
        The installation identifier supplied on the goods line (may be None).
    method:
        Emissions determination method: "actual", "default", or "estimated".
        Registry checks are only applied when method is "actual".
    goods_line_id:
        Optional goods line ID prefix for structured issue codes.
    allowlist:
        Optional frozenset of known valid IDs.  When *None*, the allowlist is
        loaded from the ``CBAM_KNOWN_INSTALLATION_IDS`` environment variable.
        Pass an empty frozenset to disable allowlist checking.

    Returns
    -------
    InstallationValidationResult
    """
    if method != "actual":
        # Non-actual methods do not require an installation registration.
        return InstallationValidationResult(is_valid=True)

    prefix = f"goods_line:{goods_line_id}:" if goods_line_id else ""
    missing: list[str] = []
    warnings: list[str] = []

    # ── 1. Presence check (blocking) ─────────────────────────────────────────
    if not installation_id or not str(installation_id).strip():
        missing.append(
            f"{prefix}installation_id_required_for_actual_method — "
            f"EU 2023/956 Art. 10 requires a registered installation ID "
            f"when actual embedded emissions are declared"
        )
        return InstallationValidationResult(
            is_valid=False, missing=missing, warnings=warnings
        )

    id_str = str(installation_id).strip()

    # ── 2. Format check (warning) ─────────────────────────────────────────────
    if not INSTALLATION_ID_RE.match(id_str):
        warnings.append(
            f"{prefix}installation_id_format_suspect:{id_str!r} — "
            f"expected EU EUTL format (2-letter country code + alphanumeric suffix, "
            f"e.g. DE_12345678); verify against EU CBAM Transitional Registry "
            f"(DG TAXUD) per EU 2023/956 Art. 10"
        )

    # ── 3. Allowlist check (warning) ──────────────────────────────────────────
    effective_allowlist = allowlist if allowlist is not None else _load_allowlist()
    if effective_allowlist and id_str not in effective_allowlist:
        warnings.append(
            f"{prefix}installation_id_not_in_allowlist:{id_str!r} — "
            f"ID not found in CBAM_KNOWN_INSTALLATION_IDS; "
            f"confirm registration in EU CBAM Transitional Registry (DG TAXUD)"
        )

    is_valid = not missing
    return InstallationValidationResult(
        is_valid=is_valid, missing=missing, warnings=warnings
    )
