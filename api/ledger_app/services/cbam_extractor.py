"""Backward-compatible shim — logic lives in cbam_extraction/ package.

All callers that do `from ledger_app.services.cbam_extractor import extract`
continue to work without modification.  New code should import directly from
`ledger_app.services.cbam_extraction`.
"""
from __future__ import annotations

from ledger_app.services.cbam_extraction import (  # noqa: F401
    CBAMExtractor,
    ClaudeCBAMExtractor,
)
import ledger_app.services.cbam_extraction as _pkg

# Re-exported so tests can monkeypatch cbam_extractor._EXTRACTOR.
_EXTRACTOR: CBAMExtractor = _pkg._EXTRACTOR


def extract(file_path: str, layout=None, pages=None) -> dict:
    # Looks up _EXTRACTOR in this module's globals at call time, so
    # monkeypatch.setattr(cbam_extractor, "_EXTRACTOR", stub) works correctly.
    try:
        return _EXTRACTOR.extract(file_path, layout=layout, pages=pages)
    except TypeError:
        try:
            return _EXTRACTOR.extract(file_path, layout=layout)
        except TypeError:
            return _EXTRACTOR.extract(file_path)
