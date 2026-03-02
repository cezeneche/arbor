from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


def validate_startup_config() -> None:
    database_url = (os.getenv("DATABASE_URL") or "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for nucleo-ledger startup.")


def optional_startup_warnings() -> list[str]:
    warnings: list[str] = []
    required_for_storage = ["S3_ENDPOINT_URL", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"]
    missing = [key for key in required_for_storage if not (os.getenv(key) or "").strip()]
    if missing:
        warnings.append(
            "Storage endpoints are disabled until S3 config is provided: "
            + ", ".join(missing)
        )
    return warnings

