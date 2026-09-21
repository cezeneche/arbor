"""
Field-level encryption using Fernet (AES-128-CBC + HMAC-SHA256).

FIELD_ENCRYPTION_KEY must be set — the service refuses to start without it.
Generate a key with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

decrypt_field() transparently handles rows written before encryption was enabled
by catching InvalidToken and returning the value as-is (migration-period fallback).

Sensitive fields encrypted in this codebase:
    - importer_eori    (cbam_cases table)
"""
from __future__ import annotations

import logging
import os

_logger = logging.getLogger("ledger.crypto")
_fernet = None
_fernet_loaded = False


def _get_fernet():
    global _fernet, _fernet_loaded
    if _fernet_loaded:
        return _fernet
    _fernet_loaded = True
    key = os.getenv("FIELD_ENCRYPTION_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "FIELD_ENCRYPTION_KEY is not set. "
            "Generate with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    try:
        from cryptography.fernet import Fernet
        _fernet = Fernet(key.encode())
        _logger.info("field_encryption_enabled")
    except Exception as exc:
        raise RuntimeError(f"FIELD_ENCRYPTION_KEY is invalid: {exc}") from exc
    return _fernet


def encrypt_field(value: str | None) -> str | None:
    """Encrypt a string field value. Returns None if value is None."""
    if value is None:
        return None
    return _get_fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_field(value: str | None) -> str | None:
    """
    Decrypt a string field value.

    Returns value unchanged if it is already plaintext (InvalidToken — migration-period
    rows written before encryption was enabled are returned as-is).
    """
    if value is None:
        return None
    from cryptography.fernet import InvalidToken
    try:
        return _get_fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        # Row was written before encryption was enabled — return as-is
        return value


def field_fingerprint(value: str | None) -> str | None:
    """A keyed, deterministic fingerprint of a field that is stored encrypted.

    Fernet is randomised, so two encryptions of one value never match and a
    uniqueness constraint over an encrypted column cannot fire. This gives back
    a value that can be compared and indexed without storing the plaintext:
    HMAC-SHA256 under the same key the encryption uses, so it is worthless to
    anyone without it.

    Case and surrounding space are normalised away — an EORI printed lower-case
    is the same importer, and treating it as a different one would open a second
    case for the same period.
    """
    if value is None:
        return None
    normalised = value.strip().upper()
    if not normalised:
        return None

    import hashlib  # noqa: PLC0415
    import hmac  # noqa: PLC0415

    key = os.getenv("FIELD_ENCRYPTION_KEY", "").strip()
    if not key:
        raise RuntimeError("FIELD_ENCRYPTION_KEY is not set; a fingerprint cannot be keyed.")
    return hmac.new(key.encode(), normalised.encode("utf-8"), hashlib.sha256).hexdigest()
