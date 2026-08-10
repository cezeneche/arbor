"""Document upload validation — MIME allowlist, magic-byte verification, size limit.

All functions are pure (no I/O). Raise ``ValueError`` with a human-readable
message on rejection so callers can map directly to HTTP 400.
"""
from __future__ import annotations

import os

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB per file
MAX_BATCH_FILES = 10

ALLOWED_MIME_TYPES: frozenset[str] = frozenset(
    {
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # xlsx
        "application/vnd.ms-excel",  # xls
        "text/csv",
        "text/plain",
        "application/xml",
        "text/xml",
    }
)

# (magic_prefix, detected_mime) — first 8 bytes checked in order
_MAGIC: list[tuple[bytes, str]] = [
    (b"%PDF", "application/pdf"),
    (b"PK\x03\x04", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    (b"\xd0\xcf\x11\xe0", "application/vnd.ms-excel"),
    (b"<?xml", "text/xml"),
]

# Content prefixes that are unconditionally rejected (executables, scripts)
_BLOCKED_MAGIC: list[bytes] = [
    b"MZ",               # Windows PE executable
    b"\x7fELF",          # Linux ELF
    b"\xca\xfe\xba\xbe", # Mach-O universal binary
    b"#!/",              # shebang interpreter scripts
]

_EXT_MIME_MAP: dict[str, str] = {
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".xml": "application/xml",
}


def _effective_mime(content_type: str | None, filename: str) -> str | None:
    """Return the effective MIME type from the Content-Type header or filename extension."""
    declared = (content_type or "").split(";")[0].strip().lower()
    if declared:
        return declared
    ext = os.path.splitext(filename.lower())[1]
    return _EXT_MIME_MAP.get(ext)


def _detect_from_magic(data: bytes) -> str | None:
    """Return the MIME type detected from magic bytes, or None if unknown."""
    header = data[:8]
    for prefix, mime in _MAGIC:
        if header.startswith(prefix):
            return mime
    return None


def validate_upload(filename: str, content_type: str | None, data: bytes) -> None:
    """Raise ``ValueError`` if the upload should be rejected.

    Checks in order:
    1. File size against ``MAX_FILE_SIZE``.
    2. Known-dangerous magic bytes (executables, scripts).
    3. Effective MIME type against ``ALLOWED_MIME_TYPES``.
    4. Magic-byte fingerprint contradicts the declared/inferred MIME type.
    """
    if len(data) > MAX_FILE_SIZE:
        mb = MAX_FILE_SIZE // (1024 * 1024)
        raise ValueError(f"File exceeds maximum allowed size of {mb} MB")

    header = data[:8]
    for blocked in _BLOCKED_MAGIC:
        if header.startswith(blocked):
            raise ValueError(
                "File content is not permitted (executable or script detected)"
            )

    effective = _effective_mime(content_type, filename)
    if effective and effective not in ALLOWED_MIME_TYPES:
        allowed = ", ".join(sorted(ALLOWED_MIME_TYPES))
        raise ValueError(
            f"Content type '{effective}' is not accepted. "
            f"Allowed types: {allowed}"
        )

    detected = _detect_from_magic(data)
    if detected is not None and effective is not None and detected != effective:
        raise ValueError(
            f"File content does not match declared type. "
            f"Declared: '{effective}', detected from file: '{detected}'"
        )
