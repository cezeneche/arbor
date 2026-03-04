"""
Field-level encryption using Fernet (AES-128-CBC + HMAC-SHA256).

Activated by setting FIELD_ENCRYPTION_KEY to a valid Fernet key.
Generate a key with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

When FIELD_ENCRYPTION_KEY is not set, encrypt_field() and decrypt_field() are
pass-throughs — plaintext is stored as-is.  This allows gradual rollout: set the key
in production, and the decrypt_field() InvalidToken fallback handles pre-encryption
rows transparently.

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
        _fernet = None
        return None
    try:
        from cryptography.fernet import Fernet
        _fernet = Fernet(key.encode())
        _logger.info("field_encryption_enabled")
    except Exception as exc:
        _logger.error("field_encryption_key_invalid: %s — encryption disabled", exc)
        _fernet = None
    return _fernet


def encrypt_field(value: str | None) -> str | None:
    """Encrypt a string field value. Returns value unchanged if encryption is disabled."""
    if value is None:
        return None
    f = _get_fernet()
    if f is None:
        return value
    return f.encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_field(value: str | None) -> str | None:
    """
    Decrypt a string field value.

    Returns value unchanged if:
      - encryption is disabled (no key), or
      - the value is already plaintext (InvalidToken during migration period)
    """
    if value is None:
        return None
    f = _get_fernet()
    if f is None:
        return value
    try:
        from cryptography.fernet import InvalidToken
        return f.decrypt(value.encode("ascii")).decode("utf-8")
    except Exception:
        # Value was stored before encryption was enabled — return as-is
        return value
