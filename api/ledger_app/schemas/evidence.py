from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class EvidenceSpan(BaseModel):
    start: int
    end: int


class EvidenceBBox(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float


class EvidenceAtom(BaseModel):
    field: str
    value: Any
    source: str
    page: int | None = None
    span: EvidenceSpan | None = None
    bbox: EvidenceBBox | None = None
    confidence: float | None = None
    snippet: str | None = None

