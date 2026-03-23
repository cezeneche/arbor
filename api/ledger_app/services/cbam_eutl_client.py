"""
EEA EU Transaction Log (EUTL) Installation Registry Client

Source: EU Regulation 2023/956, Article 10 — installation identifiers must be
registered in the EUTL.  The EEA publishes a public REST API at:
    https://eutl.eea.europa.eu/api/v1

This module provides:
- ``lookup_installation(id_str)`` — looks up an installation by ID; caches results.
- ``EUTLInstallationInfo`` — result dataclass (found, active, name, country, status).
- ``reset_cache()`` — clears in-memory TTL cache (used in tests).

Configuration (all optional, read at call time):
    CBAM_EUTL_API_URL           Base URL of the EUTL API.
                                Default: https://eutl.eea.europa.eu/api/v1
                                Set to empty string to disable EUTL checks.
    CBAM_EUTL_TIMEOUT_SECONDS   HTTP request timeout in seconds.  Default: 5.0
    CBAM_EUTL_CACHE_TTL_SECONDS Cache TTL in seconds.  Default: 3600 (1 hour)

Graceful degradation:
- Network errors or unexpected HTTP status codes → logged as warnings; ``None``
  returned so the caller can skip emitting a data-quality warning.
- When the client is disabled (CBAM_EUTL_API_URL="") → ``None`` returned.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any

_logger = logging.getLogger("ledger.cbam_eutl_client")

__all__ = [
    "EUTLInstallationInfo",
    "lookup_installation",
    "reset_cache",
    "EUTL_DEFAULT_BASE_URL",
]

EUTL_DEFAULT_BASE_URL = "https://eutl.eea.europa.eu/api/v1"

# Permit statuses that indicate the installation is no longer active.
# All comparisons are case-insensitive.
_INACTIVE_STATUSES: frozenset[str] = frozenset(
    {"surrendered", "revoked", "cancelled", "closed", "withdrawn"}
)


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass(frozen=True)
class EUTLInstallationInfo:
    """Result of a single EUTL installation lookup.

    Attributes
    ----------
    found :
        True if the EUTL returned a record for this ID.
    active :
        True if the permit is open / not surrendered or revoked.
        Only meaningful when ``found`` is True.
    name :
        Installation name as returned by the EUTL API, or None.
    country_code :
        2-letter ISO country code from the EUTL response, or None.
    permit_status :
        Raw permit_status field from the API response, or None.
    """
    found: bool
    active: bool
    name: str | None = field(default=None)
    country_code: str | None = field(default=None)
    permit_status: str | None = field(default=None)


# ── In-memory TTL cache ───────────────────────────────────────────────────────

@dataclass
class _CacheEntry:
    info: EUTLInstallationInfo
    expires_at: float  # time.monotonic() + TTL


_cache: dict[str, _CacheEntry] = {}
_cache_lock: threading.Lock = threading.Lock()


def reset_cache() -> None:
    """Clear the in-memory EUTL cache.  Intended for use in tests."""
    with _cache_lock:
        _cache.clear()


def _get_cached(key: str) -> EUTLInstallationInfo | None:
    with _cache_lock:
        entry = _cache.get(key)
        if entry is None:
            return None
        if time.monotonic() > entry.expires_at:
            del _cache[key]
            return None
        return entry.info


def _set_cached(key: str, info: EUTLInstallationInfo, ttl: float) -> None:
    with _cache_lock:
        _cache[key] = _CacheEntry(info=info, expires_at=time.monotonic() + ttl)


# ── Active status helper ──────────────────────────────────────────────────────

def _is_active(permit_status: str | None) -> bool:
    """Return True when the permit is considered active.

    Treats an absent/unknown status as active (conservative — avoid false
    positives during transitional period when not all EUTL records are
    uniformly populated).
    """
    if not permit_status:
        return True
    return permit_status.strip().lower() not in _INACTIVE_STATUSES


def _parse_permit_status(data: dict[str, Any]) -> str | None:
    """Extract permit_status from EUTL response JSON, trying several field names."""
    for key in ("permit_status", "permitStatus", "status", "permitstatus"):
        val = data.get(key)
        if val is not None:
            return str(val)
    return None


def _parse_installation_name(data: dict[str, Any]) -> str | None:
    for key in ("installation_name", "installationName", "name"):
        val = data.get(key)
        if val is not None:
            return str(val)
    return None


def _parse_country_code(data: dict[str, Any]) -> str | None:
    for key in ("country_code", "countryCode", "country"):
        val = data.get(key)
        if val is not None:
            return str(val)[:2].upper() if val else None
    return None


# ── HTTP fetch ────────────────────────────────────────────────────────────────

def _fetch(id_str: str, base_url: str, timeout: float) -> EUTLInstallationInfo | None:
    """Perform the actual HTTP GET against the EUTL API.

    Returns
    -------
    EUTLInstallationInfo
        On 200 or 404.
    None
        On network errors or unexpected status codes — caller should skip
        emitting a data-quality warning rather than producing a false positive.
    """
    url = f"{base_url.rstrip('/')}/installations/{id_str}"
    try:
        import httpx  # lazy import — only needed when EUTL checks are enabled
        resp = httpx.get(url, timeout=timeout, follow_redirects=True)
    except Exception as exc:
        _logger.warning("eutl_registry_unreachable id=%s error=%s", id_str, exc)
        return None

    if resp.status_code == 404:
        return EUTLInstallationInfo(found=False, active=False)

    if resp.status_code == 200:
        try:
            data: dict[str, Any] = resp.json()
            # The API may return a list (search endpoint) or a single object.
            if isinstance(data, list):
                if not data:
                    return EUTLInstallationInfo(found=False, active=False)
                data = data[0]
            permit_status = _parse_permit_status(data)
            return EUTLInstallationInfo(
                found=True,
                active=_is_active(permit_status),
                name=_parse_installation_name(data),
                country_code=_parse_country_code(data),
                permit_status=permit_status,
            )
        except Exception as exc:
            _logger.warning(
                "eutl_registry_parse_error id=%s status=%s error=%s",
                id_str, resp.status_code, exc,
            )
            # Response received but unparseable → treat as found (avoid false positive)
            return EUTLInstallationInfo(found=True, active=True)

    # Unexpected status (5xx, 429, etc.) — log and skip to avoid false positives
    _logger.warning(
        "eutl_registry_unexpected_status id=%s status=%s",
        id_str, resp.status_code,
    )
    return None


# ── Public API ────────────────────────────────────────────────────────────────

def lookup_installation(id_str: str) -> EUTLInstallationInfo | None:
    """Look up an installation in the EEA EUTL.

    Results are cached for ``CBAM_EUTL_CACHE_TTL_SECONDS`` (default 3600 s).
    Network errors and unexpected HTTP responses return ``None`` — the caller
    must not emit a data-quality warning in this case (graceful degradation).

    Returns ``None`` when the EUTL client is disabled
    (``CBAM_EUTL_API_URL`` explicitly set to empty string).

    Parameters
    ----------
    id_str :
        Installation identifier, e.g. ``"DE_12345678"``.
    """
    base_url = os.getenv("CBAM_EUTL_API_URL", EUTL_DEFAULT_BASE_URL).strip()
    if not base_url:
        # Explicitly disabled
        return None

    try:
        timeout = float(os.getenv("CBAM_EUTL_TIMEOUT_SECONDS", "5.0"))
    except ValueError:
        timeout = 5.0

    try:
        ttl = float(os.getenv("CBAM_EUTL_CACHE_TTL_SECONDS", "3600"))
    except ValueError:
        ttl = 3600.0

    cache_key = id_str.upper()
    cached = _get_cached(cache_key)
    if cached is not None:
        _logger.debug("eutl_cache_hit id=%s", id_str)
        return cached

    _logger.debug("eutl_cache_miss id=%s — fetching from %s", id_str, base_url)
    result = _fetch(id_str, base_url, timeout)

    if result is not None:
        # Only cache definitive answers (200 or 404); None (errors) are not cached
        # so the next call will retry.
        _set_cached(cache_key, result, ttl)

    return result
