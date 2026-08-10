"""Startup configuration validation.

The narrative pipeline and Claude gap-fill extraction both require an Anthropic
key. Outside production a missing key is a non-fatal warning (regex-only
fallback); in production it must be a hard startup failure so a silently
degraded pipeline never reaches a customer's return.
"""

from __future__ import annotations

import pytest

from ledger_app.core.config import validate_startup_config


def _set_required_config(monkeypatch) -> None:
    """Set every hard-required startup value except ANTHROPIC_API_KEY."""
    monkeypatch.setenv("DATABASE_URL", "sqlite:///./cbam_test.db")
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret")
    monkeypatch.setenv("AUDIT_SIGNING_KEY", "test-audit-signing-key")
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", "test-field-encryption-key")


def test_production_requires_anthropic_key(monkeypatch):
    _set_required_config(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY is required in production"):
        validate_startup_config()


def test_production_passes_with_anthropic_key(monkeypatch):
    _set_required_config(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

    validate_startup_config()


def test_development_allows_missing_anthropic_key(monkeypatch):
    _set_required_config(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    validate_startup_config()
