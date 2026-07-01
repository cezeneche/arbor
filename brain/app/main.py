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
from .models import (
    CalibrationFitRequest,
    CalibrationFitResponse,
    GroupCalibration,
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
