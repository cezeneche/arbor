"""Upgrade 1 — Bayesian fusion + calibration measurement (pure stdlib).

Confidence displayed to a user is only defensible if it is empirically
calibrated: when Arbor says 0.8, the extraction should be right ~80% of the
time. This module measures that and corrects for it.

Input is a stream of ground-truth labels drawn from the GroundTruthLabel table:
each is the model's confidence at extraction paired with whether the extracted
value survived human review unchanged (i.e. was correct). From those we compute:

  - Brier score         — mean squared error of the probabilistic predictions.
  - Expected Calibration Error (ECE) — the headline gap between stated
                          confidence and empirical accuracy, binned.
  - Reliability diagram  — per-bin predicted-vs-actual, for the customer-facing
                          data-quality health indicator.
  - A calibration map    — isotonic (Pool Adjacent Violators) regression mapping
                          raw score -> calibrated probability. Returned as knots
                          so the TypeScript ingestion path applies it without
                          needing the brain online.

Deliberately dependency-free: no numpy, no sklearn. The maths is transparent and
auditable, which matters more here than raw speed — the corpus of labels is
small and the fit runs offline, never in the write path.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Sample:
    """One ground-truth datapoint: the model's score and whether it was correct."""
    score: float
    correct: bool


def brier_score(samples: list[Sample]) -> float:
    """Mean squared error between predicted probability and outcome. NaN if empty."""
    if not samples:
        return float("nan")
    total = 0.0
    for s in samples:
        outcome = 1.0 if s.correct else 0.0
        total += (s.score - outcome) ** 2
    return total / len(samples)


def _bin_index(score: float, bins: int) -> int:
    """Equal-width bin over [0, 1]; the top edge (1.0) falls in the last bin."""
    idx = int(score * bins)
    if idx >= bins:
        idx = bins - 1
    if idx < 0:
        idx = 0
    return idx


def expected_calibration_error(samples: list[Sample], bins: int = 10) -> float:
    """Weighted mean gap between mean confidence and accuracy across equal-width bins."""
    if not samples:
        return float("nan")
    n = len(samples)
    conf_sum = [0.0] * bins
    acc_sum = [0.0] * bins
    count = [0] * bins
    for s in samples:
        b = _bin_index(s.score, bins)
        conf_sum[b] += s.score
        acc_sum[b] += 1.0 if s.correct else 0.0
        count[b] += 1
    ece = 0.0
    for b in range(bins):
        if count[b] == 0:
            continue
        conf = conf_sum[b] / count[b]
        acc = acc_sum[b] / count[b]
        ece += (count[b] / n) * abs(acc - conf)
    return ece


def reliability_bins(samples: list[Sample], bins: int = 10) -> list[dict]:
    """Per non-empty bin: predicted vs empirical accuracy, for the reliability diagram."""
    conf_sum = [0.0] * bins
    acc_sum = [0.0] * bins
    count = [0] * bins
    for s in samples:
        b = _bin_index(s.score, bins)
        conf_sum[b] += s.score
        acc_sum[b] += 1.0 if s.correct else 0.0
        count[b] += 1
    rows = []
    width = 1.0 / bins
    for b in range(bins):
        if count[b] == 0:
            continue
        rows.append({
            "bin_lower": b * width,
            "bin_upper": (b + 1) * width,
            "mean_predicted": conf_sum[b] / count[b],
            "empirical_accuracy": acc_sum[b] / count[b],
            "count": count[b],
        })
    return rows


def pav_isotonic(y: list[float], weights: Optional[list[float]] = None) -> list[float]:
    """Pool Adjacent Violators: least-squares isotonic (non-decreasing) fit of y.

    `y` must already be ordered by the independent variable (ascending score).
    Returns fitted values, one per input, guaranteed non-decreasing.
    """
    n = len(y)
    if n == 0:
        return []
    w = weights if weights is not None else [1.0] * n
    # Stack of pooled blocks: [value, weight, count].
    blocks: list[list[float]] = []
    for i in range(n):
        value = y[i]
        weight = w[i]
        cnt = 1.0
        while blocks and blocks[-1][0] > value:
            pv, pw, pc = blocks.pop()
            new_w = pw + weight
            value = (pv * pw + value * weight) / new_w
            weight = new_w
            cnt += pc
        blocks.append([value, weight, cnt])
    fitted: list[float] = []
    for value, _weight, cnt in blocks:
        fitted.extend([value] * int(cnt))
    return fitted


def fit_isotonic(samples: list[Sample]) -> dict:
    """Fit an isotonic calibration map; returns knots {method, x, y} for interpolation."""
    if not samples:
        return {"method": "isotonic", "x": [], "y": []}
    ordered = sorted(samples, key=lambda s: s.score)
    xs = [s.score for s in ordered]
    ys = [1.0 if s.correct else 0.0 for s in ordered]
    fitted = pav_isotonic(ys)
    # Collapse to knots: for each distinct x keep the last fitted value, then drop
    # interior points that lie on a straight (equal-value) run to keep the map small.
    knot_x: list[float] = []
    knot_y: list[float] = []
    for x, f in zip(xs, fitted):
        if knot_x and knot_x[-1] == x:
            knot_y[-1] = f
        else:
            knot_x.append(x)
            knot_y.append(f)
    return {"method": "isotonic", "x": knot_x, "y": knot_y}


def apply_calibration(cal: dict, score: float) -> float:
    """Apply a calibration map to a raw score via clipped piecewise-linear interpolation."""
    xs = cal["x"]
    ys = cal["y"]
    if not xs:
        return score
    if score <= xs[0]:
        return ys[0]
    if score >= xs[-1]:
        return ys[-1]
    # Binary-free linear scan (knot lists are short after collapsing).
    for i in range(1, len(xs)):
        if score <= xs[i]:
            x0, x1 = xs[i - 1], xs[i]
            y0, y1 = ys[i - 1], ys[i]
            if x1 == x0:
                return y1
            t = (score - x0) / (x1 - x0)
            return y0 + t * (y1 - y0)
    return ys[-1]


def fit_calibration(samples: list[Sample], bins: int = 10) -> dict:
    """Full calibration report for one group: metrics + reliability + map."""
    return {
        "n": len(samples),
        "brier": brier_score(samples),
        "ece": expected_calibration_error(samples, bins),
        "reliability": reliability_bins(samples, bins),
        "calibration_map": fit_isotonic(samples),
    }
