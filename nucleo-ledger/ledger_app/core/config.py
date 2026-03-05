from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


def validate_startup_config() -> None:
    database_url = (os.getenv("DATABASE_URL") or "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for nucleo-ledger startup.")
    jwt_secret = (os.getenv("JWT_SECRET") or "").strip()
    if not jwt_secret:
        raise RuntimeError(
            "JWT_SECRET is required for nucleo-ledger startup. "
            "Set a strong secret in your .env file."
        )
    audit_key = (os.getenv("AUDIT_SIGNING_KEY") or "").strip()
    if not audit_key:
        raise RuntimeError(
            "AUDIT_SIGNING_KEY is required for nucleo-ledger startup. "
            "Set a dedicated signing key distinct from JWT_SECRET."
        )
    if audit_key == jwt_secret:
        raise RuntimeError(
            "AUDIT_SIGNING_KEY must differ from JWT_SECRET. "
            "A shared key means a JWT compromise also forges audit logs."
        )
    field_enc_key = (os.getenv("FIELD_ENCRYPTION_KEY") or "").strip()
    if not field_enc_key:
        raise RuntimeError(
            "FIELD_ENCRYPTION_KEY is required for nucleo-ledger startup. "
            "Generate with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )


def optional_startup_warnings() -> list[str]:
    warnings: list[str] = []
    required_for_storage = ["S3_ENDPOINT_URL", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"]
    missing = [key for key in required_for_storage if not (os.getenv(key) or "").strip()]
    if missing:
        warnings.append(
            "Storage endpoints are disabled until S3 config is provided: "
            + ", ".join(missing)
        )
    if not (os.getenv("ANTHROPIC_API_KEY") or "").strip():
        warnings.append(
            "ANTHROPIC_API_KEY not set; Claude gap-fill extraction will be skipped "
            "(extractor falls back to regex-only)."
        )
    if not (os.getenv("CBAM_INSTALLATION_REGISTRY_URL") or "").strip():
        warnings.append(
            "CBAM_INSTALLATION_REGISTRY_URL not set; installation validation uses "
            "allowlist (CBAM_KNOWN_INSTALLATION_IDS) only."
        )
    if not (os.getenv("AWS_SECRET_NAME") or "").strip():
        warnings.append(
            "AWS_SECRET_NAME not set; secrets loaded from environment variables. "
            "Set AWS_SECRET_NAME + AWS_REGION to use AWS Secrets Manager in production."
        )
    slack_url = (os.getenv("SLACK_WEBHOOK_URL") or "").strip()
    slack_events = os.getenv("SLACK_NOTIFY_EVENTS", "human_review_required,cbam_calculation_completed")
    if slack_url:
        warnings.append(
            f"Slack notifications ENABLED — events: {slack_events}"
        )
    else:
        warnings.append(
            "SLACK_WEBHOOK_URL not set; Slack notifications are disabled. "
            "Set SLACK_WEBHOOK_URL in .env to enable human-review and calculation alerts."
        )

    return warnings

