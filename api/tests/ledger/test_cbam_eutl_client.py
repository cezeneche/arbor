"""Tests for cbam_eutl_client — EEA EUTL installation registry HTTP client.

Coverage:
- 200 response with active permit → found=True, active=True
- 200 response with surrendered permit → found=True, active=False
- 200 response with missing permit_status → active=True (conservative default)
- 200 response returning a list (search endpoint) → parsed correctly
- 200 response returning empty list → found=False
- 200 with unparseable JSON → found=True, active=True (graceful)
- 404 response → found=False, active=False
- Network / timeout exception → returns None (graceful)
- Unexpected HTTP status (503) → returns None (graceful)
- Cache hit: second call does not invoke httpx.get again
- Cache miss after TTL expiry: second call DOES invoke httpx.get
- reset_cache() clears entries
- CBAM_EUTL_API_URL="" → client disabled, returns None
- Integration: validate_installation_id with mocked 404 → not_in_eutl warning
- Integration: validate_installation_id with mocked surrendered → inactive warning
- Integration: network error → no warning emitted (graceful pass-through)
- Integration: CBAM_EUTL_API_URL="" → no EUTL warning (client disabled)
- Custom CBAM_INSTALLATION_REGISTRY_URL → skips EUTL, uses custom URL
"""

from __future__ import annotations

import json
import os
import time
from unittest.mock import MagicMock, patch

import pytest

import ledger_app.services.cbam_eutl_client as eutl_mod
from ledger_app.services.cbam_eutl_client import (
    EUTLInstallationInfo,
    lookup_installation,
    reset_cache,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mock_response(status_code: int, body: dict | list | None = None) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    if body is not None:
        resp.json.return_value = body
    else:
        resp.json.side_effect = Exception("no body")
    return resp


@pytest.fixture(autouse=True)
def _clear_eutl_cache(monkeypatch):
    """Reset cache and env vars before every test."""
    reset_cache()
    # Default: EUTL enabled with a local mock URL so tests don't hit the internet
    monkeypatch.setenv("CBAM_EUTL_API_URL", "http://mock-eutl.local/api/v1")
    monkeypatch.setenv("CBAM_EUTL_CACHE_TTL_SECONDS", "3600")
    monkeypatch.setenv("CBAM_EUTL_TIMEOUT_SECONDS", "5.0")
    # Ensure custom registry URL is absent unless set by the test
    monkeypatch.delenv("CBAM_INSTALLATION_REGISTRY_URL", raising=False)
    yield
    reset_cache()


# ── Unit tests: lookup_installation ──────────────────────────────────────────

class TestLookupInstallation:

    def test_found_active(self):
        body = {
            "installation_identifier": "DE_12345678",
            "installation_name": "Steel Plant Duisburg",
            "country_code": "DE",
            "permit_status": "A2_OPEN",
        }
        with patch("httpx.get", return_value=_mock_response(200, body)) as mock_get:
            result = lookup_installation("DE_12345678")
        assert result is not None
        assert result.found is True
        assert result.active is True
        assert result.name == "Steel Plant Duisburg"
        assert result.country_code == "DE"
        assert result.permit_status == "A2_OPEN"
        mock_get.assert_called_once()

    def test_found_surrendered(self):
        body = {
            "installation_identifier": "DE_99999",
            "permit_status": "surrendered",
        }
        with patch("httpx.get", return_value=_mock_response(200, body)):
            result = lookup_installation("DE_99999")
        assert result is not None
        assert result.found is True
        assert result.active is False
        assert result.permit_status == "surrendered"

    def test_found_revoked(self):
        body = {"installation_identifier": "FR_ABC", "permit_status": "REVOKED"}
        with patch("httpx.get", return_value=_mock_response(200, body)):
            result = lookup_installation("FR_ABC")
        assert result is not None
        assert result.active is False

    def test_found_missing_status_defaults_to_active(self):
        """No permit_status field → conservatively treat as active."""
        body = {"installation_identifier": "DE_12345678", "installation_name": "Plant A"}
        with patch("httpx.get", return_value=_mock_response(200, body)):
            result = lookup_installation("DE_12345678")
        assert result is not None
        assert result.found is True
        assert result.active is True  # conservative default
        assert result.permit_status is None

    def test_found_list_response(self):
        """API returns a JSON array (search endpoint pattern)."""
        body = [
            {
                "installation_identifier": "GB_TL_001",
                "permit_status": "A2_OPEN",
                "country_code": "GB",
            }
        ]
        with patch("httpx.get", return_value=_mock_response(200, body)):
            result = lookup_installation("GB_TL_001")
        assert result is not None
        assert result.found is True
        assert result.active is True
        assert result.country_code == "GB"

    def test_empty_list_response_not_found(self):
        """API returns empty list → installation not found."""
        with patch("httpx.get", return_value=_mock_response(200, [])):
            result = lookup_installation("XX_000000")
        assert result is not None
        assert result.found is False
        assert result.active is False

    def test_not_found_404(self):
        with patch("httpx.get", return_value=_mock_response(404)):
            result = lookup_installation("DE_NOTEXIST")
        assert result is not None
        assert result.found is False
        assert result.active is False

    def test_network_error_returns_none(self):
        import httpx
        with patch("httpx.get", side_effect=httpx.ConnectError("refused")):
            result = lookup_installation("DE_12345678")
        assert result is None  # graceful

    def test_timeout_returns_none(self):
        import httpx
        with patch("httpx.get", side_effect=httpx.TimeoutException("timeout")):
            result = lookup_installation("DE_12345678")
        assert result is None  # graceful

    def test_unexpected_status_503_returns_none(self):
        with patch("httpx.get", return_value=_mock_response(503)):
            result = lookup_installation("DE_12345678")
        assert result is None  # graceful, no false positive

    def test_unparseable_json_returns_found_active(self):
        """Unparseable 200 body → conservatively treat as found+active."""
        resp = MagicMock()
        resp.status_code = 200
        resp.json.side_effect = ValueError("not json")
        with patch("httpx.get", return_value=resp):
            result = lookup_installation("DE_12345678")
        assert result is not None
        assert result.found is True
        assert result.active is True

    def test_camel_case_fields_parsed(self):
        """API may return camelCase field names."""
        body = {
            "installationName": "Cement Works",
            "countryCode": "PL",
            "permitStatus": "surrendered",
        }
        with patch("httpx.get", return_value=_mock_response(200, body)):
            result = lookup_installation("PL_12345")
        assert result is not None
        assert result.found is True
        assert result.active is False
        assert result.name == "Cement Works"
        assert result.country_code == "PL"


# ── Cache behaviour ───────────────────────────────────────────────────────────

class TestCache:

    def test_cache_hit_skips_http(self):
        body = {"installation_identifier": "DE_12345678", "permit_status": "A2_OPEN"}
        with patch("httpx.get", return_value=_mock_response(200, body)) as mock_get:
            r1 = lookup_installation("DE_12345678")
            r2 = lookup_installation("DE_12345678")
        assert r1 == r2
        assert mock_get.call_count == 1  # second call served from cache

    def test_cache_key_is_case_insensitive(self):
        body = {"permit_status": "A2_OPEN"}
        with patch("httpx.get", return_value=_mock_response(200, body)) as mock_get:
            lookup_installation("DE_12345678")
            lookup_installation("de_12345678")
        assert mock_get.call_count == 1

    def test_cache_miss_after_ttl(self, monkeypatch):
        monkeypatch.setenv("CBAM_EUTL_CACHE_TTL_SECONDS", "0.05")  # 50 ms TTL
        body = {"permit_status": "A2_OPEN"}
        with patch("httpx.get", return_value=_mock_response(200, body)) as mock_get:
            lookup_installation("DE_12345678")
            time.sleep(0.1)  # wait for TTL to expire
            lookup_installation("DE_12345678")
        assert mock_get.call_count == 2

    def test_reset_cache_clears_entries(self):
        body = {"permit_status": "A2_OPEN"}
        with patch("httpx.get", return_value=_mock_response(200, body)) as mock_get:
            lookup_installation("DE_12345678")
            reset_cache()
            lookup_installation("DE_12345678")
        assert mock_get.call_count == 2

    def test_network_error_not_cached(self):
        """None results (network errors) must not be cached — next call should retry."""
        import httpx
        with patch("httpx.get", side_effect=httpx.ConnectError("refused")) as mock_get:
            lookup_installation("DE_12345678")
            lookup_installation("DE_12345678")
        assert mock_get.call_count == 2

    def test_disabled_client_returns_none(self, monkeypatch):
        """CBAM_EUTL_API_URL="" disables the client."""
        monkeypatch.setenv("CBAM_EUTL_API_URL", "")
        with patch("httpx.get") as mock_get:
            result = lookup_installation("DE_12345678")
        assert result is None
        mock_get.assert_not_called()


# ── Integration: validate_installation_id calls EUTL client ──────────────────

class TestValidateIntegration:
    """Verify that validate_installation_id in cbam_installation_registry calls
    the EUTL client when no custom registry URL is set."""

    def _validate(self, installation_id: str, method: str = "actual") -> object:
        from ledger_app.services.cbam_installation_registry import validate_installation_id
        return validate_installation_id(
            installation_id, method=method, allowlist=frozenset()
        )

    def test_eutl_404_produces_not_in_eutl_warning(self):
        with patch("httpx.get", return_value=_mock_response(404)):
            result = self._validate("DE_12345678")
        assert result.is_valid is True  # not blocking
        assert any("installation_id_not_in_eutl" in w for w in result.warnings)

    def test_eutl_surrendered_produces_inactive_warning(self):
        body = {"permit_status": "surrendered"}
        with patch("httpx.get", return_value=_mock_response(200, body)):
            result = self._validate("DE_12345678")
        assert any("installation_registry_inactive" in w for w in result.warnings)
        assert any("surrendered" in w for w in result.warnings)

    def test_eutl_active_no_warning(self):
        body = {"permit_status": "A2_OPEN"}
        with patch("httpx.get", return_value=_mock_response(200, body)):
            result = self._validate("DE_12345678")
        assert not any("not_in_eutl" in w for w in result.warnings)
        assert not any("inactive" in w for w in result.warnings)

    def test_network_error_no_warning(self):
        """Graceful degradation: unreachable EUTL must not produce false warnings."""
        import httpx
        with patch("httpx.get", side_effect=httpx.ConnectError("refused")):
            result = self._validate("DE_12345678")
        assert not any("eutl" in w for w in result.warnings)
        assert not any("inactive" in w for w in result.warnings)

    def test_disabled_client_no_eutl_warning(self, monkeypatch):
        """CBAM_EUTL_API_URL="" → no EUTL warning emitted."""
        monkeypatch.setenv("CBAM_EUTL_API_URL", "")
        with patch("httpx.get") as mock_get:
            result = self._validate("DE_12345678")
        mock_get.assert_not_called()
        assert not any("eutl" in w for w in result.warnings)

    def test_custom_registry_url_skips_eutl_client(self, monkeypatch):
        """When CBAM_INSTALLATION_REGISTRY_URL is set, EUTL client is not called."""
        monkeypatch.setenv(
            "CBAM_INSTALLATION_REGISTRY_URL",
            "http://taxud-registry.local",
        )
        custom_resp = _mock_response(200)
        with patch("httpx.get", return_value=custom_resp) as mock_get:
            result = self._validate("DE_12345678")
        # httpx.get called once (custom registry), not the EUTL client
        assert mock_get.call_count == 1
        called_url = mock_get.call_args[0][0]
        assert "taxud-registry.local" in called_url
        assert "eutl" not in called_url.lower()

    def test_custom_registry_url_404_warns(self, monkeypatch):
        monkeypatch.setenv(
            "CBAM_INSTALLATION_REGISTRY_URL",
            "http://taxud-registry.local",
        )
        with patch("httpx.get", return_value=_mock_response(404)):
            result = self._validate("DE_12345678")
        assert any("not_in_registry" in w for w in result.warnings)

    def test_non_actual_method_skips_eutl(self):
        """method != 'actual' → no EUTL call at all."""
        with patch("httpx.get") as mock_get:
            result = self._validate("DE_12345678", method="default")
        mock_get.assert_not_called()
        assert result.is_valid is True
