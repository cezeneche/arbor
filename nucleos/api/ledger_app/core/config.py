"""
Central application configuration and feature-flag registry.

All env-var reads are concentrated here so that:
  - The full configuration surface is visible in one file.
  - Production operators have a single reference for what to set.
  - Tests can override by setting os.environ before importing this module.

Usage (feature flags in main.py):
    from ledger_app.core.config import AppConfig
    if AppConfig.supabase_enabled:
        ...
"""
from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


# ── Typed feature-flag registry ───────────────────────────────────────────────

class AppConfig:
    """
    Read-only registry of all runtime configuration values.

    Every attribute reads directly from the environment so that tests can patch
    os.environ without needing to reload this module.
    """

    # ── Database / Supabase ───────────────────────────────────────────────────

    @staticmethod
    def database_url() -> str:
        return (os.getenv("DATABASE_URL") or "").strip()

    @staticmethod
    def supabase_url() -> str:
        return (os.getenv("SUPABASE_URL") or "").strip()

    @staticmethod
    def supabase_service_key() -> str:
        return (os.getenv("SUPABASE_SERVICE_KEY") or "").strip()

    @staticmethod
    def supabase_enabled() -> bool:
        return bool((os.getenv("SUPABASE_URL") or "").strip())

    # ── Auth / JWT ────────────────────────────────────────────────────────────

    @staticmethod
    def jwt_secret() -> str:
        return (os.getenv("JWT_SECRET") or "").strip()

    @staticmethod
    def jwt_issuer() -> str:
        return os.getenv("JWT_ISSUER", "scope3-agentic")

    @staticmethod
    def jwt_audience() -> str:
        return os.getenv("JWT_AUDIENCE", "scope3-clients")

    @staticmethod
    def jwt_expires_seconds() -> int:
        return int(os.getenv("JWT_EXPIRES_SECONDS", "3600"))

    @staticmethod
    def dev_token_endpoint_enabled() -> bool:
        return os.getenv("AUTH_DEV_TOKEN_ENDPOINT", "").strip().lower() in ("1", "true", "yes")

    # ── Security ──────────────────────────────────────────────────────────────

    @staticmethod
    def audit_signing_key() -> str:
        return (os.getenv("AUDIT_SIGNING_KEY") or "").strip()

    @staticmethod
    def field_encryption_key() -> str:
        return (os.getenv("FIELD_ENCRYPTION_KEY") or "").strip()

    @staticmethod
    def force_https() -> bool:
        return os.getenv("FORCE_HTTPS", "").strip().lower() in ("1", "true", "yes")

    @staticmethod
    def environment() -> str:
        return os.getenv("ENVIRONMENT", "development").strip().lower()

    @staticmethod
    def is_production() -> bool:
        return AppConfig.environment() in ("production", "prod")

    # ── LLM / AI ─────────────────────────────────────────────────────────────

    @staticmethod
    def anthropic_api_key() -> str:
        return (os.getenv("ANTHROPIC_API_KEY") or "").strip()

    @staticmethod
    def anthropic_model() -> str:
        return os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")

    @staticmethod
    def narrative_enabled() -> bool:
        return bool((os.getenv("ANTHROPIC_API_KEY") or "").strip())

    # ── Notifications ─────────────────────────────────────────────────────────

    @staticmethod
    def slack_webhook_url() -> str:
        return (os.getenv("SLACK_WEBHOOK_URL") or "").strip()

    @staticmethod
    def slack_notify_events() -> str:
        return os.getenv(
            "SLACK_NOTIFY_EVENTS",
            "human_review_required,cbam_calculation_completed",
        )

    @staticmethod
    def resend_api_key() -> str:
        return (os.getenv("RESEND_API_KEY") or "").strip()

    @staticmethod
    def resend_from_address() -> str:
        return os.getenv("RESEND_FROM", "noreply@nucleos.app")

    # ── Scheduler ────────────────────────────────────────────────────────────

    @staticmethod
    def registration_scheduler_enabled() -> bool:
        return os.getenv("CBAM_REGISTRATION_SCHEDULER", "true").strip().lower() not in (
            "0", "false", "no"
        )

    # ── Request limits ────────────────────────────────────────────────────────

    @staticmethod
    def max_request_size_bytes() -> int:
        return int(os.getenv("MAX_REQUEST_SIZE_BYTES", str(10 * 1024 * 1024)))

    # ── CBAM external integrations ────────────────────────────────────────────

    @staticmethod
    def cbam_installation_registry_url() -> str:
        return (os.getenv("CBAM_INSTALLATION_REGISTRY_URL") or "").strip()

    @staticmethod
    def aws_secret_name() -> str:
        return (os.getenv("AWS_SECRET_NAME") or "").strip()

    @staticmethod
    def otlp_endpoint() -> str:
        return (os.getenv("OTLP_ENDPOINT") or "").strip()


# ── Startup validation ────────────────────────────────────────────────────────

def validate_startup_config() -> None:
    """
    Raise RuntimeError for any configuration that will cause a hard failure at
    request time.  Called once at module load in api/main.py.
    """
    if not AppConfig.database_url():
        raise RuntimeError("DATABASE_URL is required for startup.")

    if not AppConfig.jwt_secret():
        raise RuntimeError(
            "JWT_SECRET is required for startup. "
            "Set a strong secret in your .env file."
        )

    if not AppConfig.audit_signing_key():
        raise RuntimeError(
            "AUDIT_SIGNING_KEY is required for startup. "
            "Set a dedicated signing key distinct from JWT_SECRET."
        )

    if AppConfig.audit_signing_key() == AppConfig.jwt_secret():
        raise RuntimeError(
            "AUDIT_SIGNING_KEY must differ from JWT_SECRET. "
            "A shared key means a JWT compromise also forges audit logs."
        )

    if not AppConfig.field_encryption_key():
        raise RuntimeError(
            "FIELD_ENCRYPTION_KEY is required for startup. "
            "Generate with: "
            "python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )

    # The narrative pipeline and Claude gap-fill extraction both require an
    # Anthropic key. Outside production a missing key is a warning (regex-only
    # fallback); in production it is a hard failure — a silently degraded
    # pipeline must not reach a customer's return.
    if AppConfig.is_production() and not AppConfig.anthropic_api_key():
        raise RuntimeError(
            "ANTHROPIC_API_KEY is required in production "
            "(ENVIRONMENT=production). The narrative pipeline cannot run without it."
        )


# ── Optional startup warnings ─────────────────────────────────────────────────

def optional_startup_warnings() -> list[str]:
    """
    Return human-readable warnings for optional config that degrades functionality
    when absent.  Non-fatal — the service starts regardless.
    """
    warnings: list[str] = []

    if not AppConfig.supabase_enabled():
        warnings.append(
            "SUPABASE_URL not set; Supabase client and Storage are disabled. "
            "Set SUPABASE_URL + SUPABASE_SERVICE_KEY for production use."
        )

    if not AppConfig.anthropic_api_key():
        warnings.append(
            "ANTHROPIC_API_KEY not set; narrative pipeline will fail and "
            "Claude gap-fill extraction will be skipped (regex-only fallback)."
        )

    if not AppConfig.slack_webhook_url():
        warnings.append(
            "SLACK_WEBHOOK_URL not set; Slack notifications are disabled. "
            "Set SLACK_WEBHOOK_URL to enable human-review and calculation alerts."
        )
    else:
        warnings.append(
            f"Slack notifications ENABLED — events: {AppConfig.slack_notify_events()}"
        )

    if not AppConfig.resend_api_key():
        warnings.append(
            "RESEND_API_KEY not set; email notifications (report ready, review alerts) "
            "are disabled."
        )

    if not AppConfig.cbam_installation_registry_url():
        warnings.append(
            "CBAM_INSTALLATION_REGISTRY_URL not set; installation validation uses "
            "allowlist (CBAM_KNOWN_INSTALLATION_IDS) only."
        )

    if not AppConfig.aws_secret_name():
        warnings.append(
            "AWS_SECRET_NAME not set; secrets loaded from environment variables. "
            "Set AWS_SECRET_NAME + AWS_REGION to use AWS Secrets Manager in production."
        )

    return warnings
