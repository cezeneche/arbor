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


# ── Bayesian fusion of self-consistency samples (Upgrade 1) ──────────────────


class FieldSamples(BaseModel):
    field_name: str
    # Carried for per-document-class priors (future); currently the global prior applies.
    document_class: str
    # The k sampled raw values for this field (null = model found nothing that run).
    samples: list[Optional[str]]


class FusionRequest(BaseModel):
    fields: list[FieldSamples]
    prior_alpha: float = Field(1.0, gt=0, description="Beta prior alpha (correctness).")
    prior_beta: float = Field(1.0, gt=0, description="Beta prior beta.")


class FusedField(BaseModel):
    field_name: str
    consensus: Optional[str]
    agreement: int
    k: int
    posterior_mean: float
    ci_low: float
    ci_high: float


class FusionResponse(BaseModel):
    fields: list[FusedField]


# ── Entity-resolution baseline scoring (Upgrade 5) ───────────────────────────


class EntityName(BaseModel):
    id: str
    # Already normalised by the TypeScript blocking layer (lowercased, designators
    # stripped). The brain scores these as-is — it does not re-normalise.
    normalised: str


class ResolutionPair(BaseModel):
    a: str = Field(..., description="Entity id.")
    b: str = Field(..., description="Entity id.")


class ResolutionScoreRequest(BaseModel):
    names: list[EntityName]
    pairs: list[ResolutionPair]
    ngram: int = Field(3, ge=2, le=5, description="Character n-gram size.")
    threshold_match: float = Field(0.85, ge=0.0, le=1.0)
    threshold_review: float = Field(0.65, ge=0.0, le=1.0)


class ScoredPair(BaseModel):
    a: str
    b: str
    similarity: float
    # match (auto-merge candidate) | review (human decision) | distinct.
    decision: str


class ResolutionScoreResponse(BaseModel):
    scores: list[ScoredPair]
