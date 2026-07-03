"""Arbor brain — the Python service behind the TypeScript product.

Owns the defensible maths the plan calls for (Pillars A/B/D/E). This first cut
exposes calibration measurement (Upgrade 1). It is stateless and DB-less by
design: the TypeScript app feeds it labels and applies the returned calibration
map, so the brain is never in Arbor's write path.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import Depends, FastAPI

from .auth import require_internal_token
from .calibration import Sample, fit_calibration
from .fusion import fuse_field
from .resolution import score_pairs
from .models import (
    CalibrationFitRequest,
    CalibrationFitResponse,
    FusedField,
    FusionRequest,
    FusionResponse,
    GroupCalibration,
    ResolutionScoreRequest,
    ResolutionScoreResponse,
    ScoredPair,
)

app = FastAPI(title="Arbor Brain", version="0.1.0")


def _json_safe(x: float | None) -> float | None:
    """NaN/inf are not valid JSON — surface them as null."""
    if x is None or math.isnan(x) or math.isinf(x):
        return None
    return x


@app.get("/health")
def health() -> dict:
    """Unauthenticated liveness probe. Reveals nothing sensitive."""
    return {"status": "ok", "service": "arbor-brain", "version": app.version}


@app.post("/calibration/fit", response_model=CalibrationFitResponse)
def calibration_fit(
    req: CalibrationFitRequest,
    _auth: None = Depends(require_internal_token),
) -> CalibrationFitResponse:
    """Fit a calibration map and compute Brier / ECE / reliability per group.

    Groups are calibrated independently — the plan's kill signal tracks ECE per
    field type (supplier identity, mass, emissions intensity) — so a group with
    plenty of labels is not diluted by a sparse one.
    """
    by_group: dict[str, list[Sample]] = defaultdict(list)
    for s in req.samples:
        by_group[s.group].append(Sample(score=s.score, correct=s.correct))

    groups: list[GroupCalibration] = []
    for group in sorted(by_group):
        samples = by_group[group]
        report = fit_calibration(samples, bins=req.bins)
        groups.append(
            GroupCalibration(
                group=group,
                n=report["n"],
                brier=_json_safe(report["brier"]),
                ece=_json_safe(report["ece"]),
                reliability=report["reliability"],
                calibration_map=report["calibration_map"],
                sufficient=report["n"] >= req.min_samples,
            )
        )

    return CalibrationFitResponse(
        groups=groups,
        fitted_at=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/fusion/fields", response_model=FusionResponse)
def fusion_fields(
    req: FusionRequest,
    _auth: None = Depends(require_internal_token),
) -> FusionResponse:
    """Fuse per-field self-consistency samples into beta-binomial posteriors.

    Layer 1 sends the k sampled values for each field; the response carries the
    consensus value and a calibrated-honest confidence (posterior mean + CI) that
    the calibration pipeline can later learn from. This is 'Bayesian fusion' —
    Upgrade 1's namesake.
    """
    fields = [
        FusedField(
            field_name=f.field_name,
            **fuse_field(f.samples, prior_alpha=req.prior_alpha, prior_beta=req.prior_beta),
        )
        for f in req.fields
    ]
    return FusionResponse(fields=fields)


@app.post("/resolution/score", response_model=ResolutionScoreResponse)
def resolution_score(
    req: ResolutionScoreRequest,
    _auth: None = Depends(require_internal_token),
) -> ResolutionScoreResponse:
    """Score blocked candidate entity pairs (Upgrade 5 baseline).

    TypeScript sends the normalised names and the candidate pairs its blocking
    layer produced; the brain returns a lexical similarity per pair and bands it
    into match / review / distinct. Stateless: no DB, no embeddings, no index.
    """
    names = {n.id: n.normalised for n in req.names}
    pairs = [(p.a, p.b) for p in req.pairs]
    scored = score_pairs(
        names,
        pairs,
        ngram=req.ngram,
        threshold_match=req.threshold_match,
        threshold_review=req.threshold_review,
    )
    return ResolutionScoreResponse(scores=[ScoredPair(**s) for s in scored])
