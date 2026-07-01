"""Wire contract for the brain's calibration endpoint.

The TypeScript app queries the GroundTruthLabel table and posts the labels here
(one per field review decision) tagged with a `group` — the unit calibration is
measured over, e.g. a field type like "supplier_identity" or a document class.
The brain is stateless: it never reads Arbor's database, so it can never sit in
the write path and can be scaled or restarted freely.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class LabelSample(BaseModel):
    group: str = Field(..., description="Calibration grouping key (field type or document class).")
    score: float = Field(..., ge=0.0, le=1.0, description="Model confidence at extraction.")
    correct: bool = Field(..., description="Did the extracted value survive review unchanged.")


class CalibrationFitRequest(BaseModel):
    samples: list[LabelSample]
    bins: int = Field(10, ge=2, le=100, description="Reliability-diagram bin count.")
    min_samples: int = Field(
        30, ge=1,
        description="Groups below this are still reported but flagged not-yet-sufficient.",
    )


class ReliabilityBin(BaseModel):
    bin_lower: float
    bin_upper: float
    mean_predicted: float
    empirical_accuracy: float
    count: int


class CalibrationMap(BaseModel):
    method: str
    x: list[float]
    y: list[float]


class GroupCalibration(BaseModel):
    group: str
    n: int
    brier: Optional[float]
    ece: Optional[float]
    reliability: list[ReliabilityBin]
    calibration_map: CalibrationMap
    # True once the group has enough labels to trust the fit (n >= min_samples).
    sufficient: bool


class CalibrationFitResponse(BaseModel):
    groups: list[GroupCalibration]
    fitted_at: str
