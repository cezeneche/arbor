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
from .schema_infer import infer_schema
from .constraints import check_record, complete_missing
from .models import (
    CalibrationFitRequest,
    CalibrationFitResponse,
    ConstraintCheckRequest,
    ConstraintCheckResponse,
    ConstraintCompletion,
    ConstraintRecordResult,
    ConstraintViolation,
    FusedField,
    FusionRequest,
    FusionResponse,
    GroupCalibration,
    ResolutionScoreRequest,
    ResolutionScoreResponse,
    ScoredPair,
    SchemaInferRequest,
    SchemaInferResponse,
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


@app.post("/infotheory/schema", response_model=SchemaInferResponse)
def infotheory_schema(
    req: SchemaInferRequest,
    _auth: None = Depends(require_internal_token),
) -> SchemaInferResponse:
    """Infer a schema from field co-occurrence (Upgrade 2, schema application).

    Classifies fields into core (near-ubiquitous), groups (co-varying by mutual
    information), and noise (rarely present). Stateless: the caller sends each
    document as its list of extracted field names.
    """
    result = infer_schema(
        req.documents,
        mi_threshold=req.mi_threshold,
        core_rate=req.core_rate,
        noise_rate=req.noise_rate,
    )
    return SchemaInferResponse(**result)


@app.post("/constraints/check", response_model=ConstraintCheckResponse)
def constraints_check(
    req: ConstraintCheckRequest,
    _auth: None = Depends(require_internal_token),
) -> ConstraintCheckResponse:
    """Check records against algebraic constraints and complete missing fields
    with maximum entropy (Upgrade 3). Surfaces physically impossible / fraudulent
    records and fills determined-or-bounded gaps. Stateless; runs off any write
    path (fail-soft on the caller side)."""
    results = [
        ConstraintRecordResult(
            id=r.id,
            violations=[ConstraintViolation(**v) for v in check_record(r.fields, r.sector)],
            completions=[ConstraintCompletion(**c) for c in complete_missing(r.fields, r.sector)],
        )
        for r in req.records
    ]
    return ConstraintCheckResponse(results=results)
