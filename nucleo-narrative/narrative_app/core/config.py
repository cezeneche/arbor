import os

from dotenv import load_dotenv
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Populate os.environ from .env before pydantic-settings reads declared fields.
# This ensures that vars not declared in Settings (e.g. SLACK_WEBHOOK_URL) are
# still accessible via os.getenv() throughout the service.
load_dotenv()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    ledger_base_url: str = Field(
        default="http://127.0.0.1:8000",
        validation_alias=AliasChoices("LEDGER_URL", "LEDGER_BASE_URL", "NUCLEO_LEDGER_URL"),
    )

    openai_api_key: str | None = None
    openai_model: str = "gpt-5.2"

    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-3-5-sonnet-latest"

    gemini_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    )
    gemini_model: str = "gemini-3.1-pro"

settings = Settings()


def validate_startup_config() -> None:
    base_url = (settings.ledger_base_url or "").strip()
    if not base_url:
        raise RuntimeError("LEDGER_URL/LEDGER_BASE_URL must be set for nucleo-narrative startup.")
    if not (base_url.startswith("http://") or base_url.startswith("https://")):
        raise RuntimeError("LEDGER_URL/LEDGER_BASE_URL must start with http:// or https://.")
    import os
    jwt_secret = (os.getenv("JWT_SECRET") or "").strip()
    if not jwt_secret:
        raise RuntimeError(
            "JWT_SECRET is required for nucleo-narrative startup. "
            "Set a strong secret in your .env file."
        )


def optional_provider_warnings() -> list[str]:
    warnings: list[str] = []
    if not settings.openai_api_key:
        warnings.append("OPENAI_API_KEY is not set; legacy narrative draft stage will be unavailable.")
    if not settings.anthropic_api_key:
        warnings.append("ANTHROPIC_API_KEY is not set; Claude review stage will be skipped.")
    if not settings.gemini_api_key:
        warnings.append("GEMINI_API_KEY is not set; Gemini gate will be skipped.")

    slack_url = (os.getenv("SLACK_WEBHOOK_URL") or "").strip()
    slack_events = os.getenv("SLACK_NOTIFY_EVENTS", "pipeline_completed")
    if slack_url:
        warnings.append(
            f"Slack notifications ENABLED — events: {slack_events}"
        )
    else:
        warnings.append(
            "SLACK_WEBHOOK_URL not set; Slack notifications are disabled. "
            "Set SLACK_WEBHOOK_URL in .env to enable pipeline-completion alerts."
        )

    return warnings
