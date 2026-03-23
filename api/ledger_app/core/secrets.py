"""
Secrets management cascade: AWS Secrets Manager → environment variable.

Usage:
    from ledger_app.core.secrets import get_secret
    jwt_secret = get_secret("JWT_SECRET")

If AWS_SECRET_NAME is set, the module fetches all secrets from that Secrets Manager
secret (a JSON object) and returns the matching key.  Falls back to os.getenv when:
  - AWS_SECRET_NAME is not configured
  - The key is absent from the Secrets Manager secret
  - Secrets Manager is unreachable (network error, permissions, etc.)

The resolved value is cached in-process for the lifetime of the worker to avoid
repeated API calls on every request.
"""
from __future__ import annotations

import json
import logging
import os
from functools import lru_cache
from typing import Any

_logger = logging.getLogger("ledger.secrets")


@lru_cache(maxsize=1)
def _load_aws_secrets() -> dict[str, Any]:
    """Fetch and cache all secrets from AWS Secrets Manager. Returns {} on failure."""
    aws_secret_name = os.getenv("AWS_SECRET_NAME", "").strip()
    if not aws_secret_name:
        return {}

    try:
        import boto3

        region = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "us-east-1"))
        client = boto3.client("secretsmanager", region_name=region)
        response = client.get_secret_value(SecretId=aws_secret_name)
        secret_string = response.get("SecretString", "{}")
        secrets = json.loads(secret_string)
        _logger.info(
            "secrets_manager_loaded aws_secret_name=%s keys=%s",
            aws_secret_name,
            sorted(secrets.keys()),
        )
        return secrets
    except Exception as exc:
        _logger.warning(
            "secrets_manager_unavailable aws_secret_name=%s error=%s — falling back to env vars",
            aws_secret_name,
            exc,
        )
        return {}


def get_secret(name: str, required: bool = True) -> str:
    """
    Resolve a secret by name using the cascade: AWS Secrets Manager → env var.

    Parameters
    ----------
    name:
        The secret key name (same as the env var name, e.g. "JWT_SECRET").
    required:
        If True (default) and the secret cannot be resolved, raises RuntimeError.

    Returns
    -------
    str
        The secret value (stripped).
    """
    # 1. Try AWS Secrets Manager (cached after first call)
    aws_secrets = _load_aws_secrets()
    if name in aws_secrets:
        value = str(aws_secrets[name]).strip()
        if value:
            return value

    # 2. Fall back to environment variable
    value = (os.getenv(name) or "").strip()
    if value:
        return value

    if required:
        raise RuntimeError(
            f"Secret '{name}' not found in AWS Secrets Manager "
            f"(AWS_SECRET_NAME={os.getenv('AWS_SECRET_NAME','<not set>')!r}) "
            f"or environment variables."
        )
    return ""
