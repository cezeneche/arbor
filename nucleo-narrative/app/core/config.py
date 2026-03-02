from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AliasChoices, Field

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    ledger_base_url: str = Field(
        default="http://127.0.0.1:8000",
        validation_alias=AliasChoices("LEDGER_BASE_URL", "NUCLEO_LEDGER_URL"),
    )

    openai_api_key: str
    openai_model: str = "gpt-5.2"

    gemini_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    )
    gemini_model: str = "gemini-3.1-pro"

settings = Settings()
