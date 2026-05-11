"""Backward-compatible shim — logic lives in cbam_extraction/ package.

All callers that do `from ledger_app.services.cbam_extractor import extract`
continue to work without modification.  New code should import directly from
`ledger_app.services.cbam_extraction`.
"""
from __future__ import annotations

from ledger_app.services.cbam_extraction import (  # noqa: F401
    CBAMExtractor,
    ClaudeCBAMExtractor,
    extract,
)
