"""CBAM document extraction package.

Public API (matches the original cbam_extractor module):
  extract(file_path, layout=None, pages=None) → dict
  ClaudeCBAMExtractor
  CBAMExtractor (Protocol)
"""
from __future__ import annotations

from ._extractor import CBAMExtractor, ClaudeCBAMExtractor

_EXTRACTOR: CBAMExtractor = ClaudeCBAMExtractor()


def extract(
    file_path: str,
    layout=None,
    pages=None,
) -> dict:
    try:
        return _EXTRACTOR.extract(file_path, layout=layout, pages=pages)
    except TypeError:
        try:
            return _EXTRACTOR.extract(file_path, layout=layout)
        except TypeError:
            return _EXTRACTOR.extract(file_path)


__all__ = ["extract", "ClaudeCBAMExtractor", "CBAMExtractor"]
