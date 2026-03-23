"""
CBAM Installation Registry Validation

Source: EU Regulation 2023/956, Article 10
    'Where actual embedded emissions are used, the CBAM declaration shall include
    the identifier of the installation as registered in the CBAM Transitional
    Registry (Implementing Regulation (EU) 2023/1773, Article 5).'

This module implements four layers of validation:

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

4. **Live registry lookup** — queries a live installation registry:
   - **Default (tier 4b)**: EEA EU Transaction Log (EUTL) public REST API at
     ``CBAM_EUTL_API_URL`` (default: https://eutl.eea.europa.eu/api/v1).
     Checks whether the ID exists and whether the permit is still active.
     Results are cached in-memory for ``CBAM_EUTL_CACHE_TTL_SECONDS`` (default 1 h).
   - **Override (tier 4a)**: When ``CBAM_INSTALLATION_REGISTRY_URL`` is set, that
     custom endpoint (e.g. DG TAXUD CBAM Transitional Registry) is called instead.
   - Network errors and unexpected HTTP responses are logged and skipped gracefully
     (no false-positive warnings) so offline deployments are not penalised.

Severity matrix (EU 2023/956 Art. 10):
    method="actual", installation_id absent          → BLOCKING (missing)
    method="actual", installation_id wrong format    → WARNING
    method="actual", not in non-empty allowlist      → WARNING
    method="actual", not found in EUTL / registry   → WARNING
    method="actual", permit inactive in EUTL         → WARNING
    method != "actual"                               → no registry checks applied
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field

_logger = logging.getLogger("ledger.cbam_installation_registry")

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

    # ── 4. Live registry lookup ───────────────────────────────────────────────
    registry_url = (os.getenv("CBAM_INSTALLATION_REGISTRY_URL") or "").strip()

    if registry_url:
        # ── 4a. Custom / DG TAXUD CBAM Transitional Registry ─────────────────
        # Caller has configured a specific registry URL (e.g. the authenticated
        # DG TAXUD endpoint).  Use a simple status-code check as before.
        try:
            import httpx  # lazy import — only needed when URL is configured
            resp = httpx.get(
                f"{registry_url}/installations/{id_str}", timeout=2.0
            )
            if resp.status_code == 404:
                warnings.append(
                    f"{prefix}installation_id_not_in_registry:{id_str!r} — "
                    f"installation not found in remote registry "
                    f"(EU 2023/956 Art. 10)"
                )
            elif resp.status_code != 200:
                _logger.warning(
                    "installation_registry_check_failed id=%s status=%s",
                    id_str,
                    resp.status_code,
                )
        except Exception as exc:
            _logger.warning("installation_registry_unreachable: %s", exc)

    else:
        # ── 4b. EEA EUTL public API (default) ────────────────────────────────
        # When no custom registry URL is configured, fall back to the EEA EU
        # Transaction Log public REST API (https://eutl.eea.europa.eu/api/v1).
        # Returns None on network errors → gracefully skip to avoid false
        # positives in offline / air-gapped deployments.
        from ledger_app.services.cbam_eutl_client import lookup_installation  # lazy

        info = lookup_installation(id_str)
        if info is not None:
            if not info.found:
                warnings.append(
                    f"{prefix}installation_id_not_in_eutl:{id_str!r} — "
                    f"ID not found in EEA EU Transaction Log; "
                    f"verify registration in CBAM Transitional Registry "
                    f"(EU 2023/956 Art. 10)"
                )
            elif not info.active:
                warnings.append(
                    f"{prefix}installation_registry_inactive:{id_str!r} "
                    f"permit_status={info.permit_status!r} — "
                    f"installation permit is no longer active in EUTL "
                    f"(EU 2023/956 Art. 10); declaration may be rejected"
                )

    is_valid = not missing
    return InstallationValidationResult(
        is_valid=is_valid, missing=missing, warnings=warnings
    )
