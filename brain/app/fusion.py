"""Upgrade 1 — Bayesian fusion of self-consistency samples (pure stdlib).

Layer 1 runs the extraction k times at temperature > 0. For each field we get k
sampled values; their agreement is the confidence signal. We fuse it as a
beta-binomial posterior over "is this field correct", with a conjugate Beta
prior per document class:

    posterior = Beta(alpha + agreement, beta + (k - agreement))

Even unanimous agreement is smoothed by the prior, so confidence is never a
naive 1.0 — it stays numerically honest and, crucially, *varies*, which is what
the calibration layer (calibration.py) needs to learn from.

Dependency-free: exact posterior mean, normal-approximation credible interval
(via statistics.NormalDist). The corpus is small and this runs off the hot path.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from statistics import NormalDist
from typing import Optional

_LEADING_NUMBER = re.compile(r"^-?\d[\d,]*\.?\d*")


def _as_number(s: str) -> Optional[float]:
    """Parse a leading number, tolerating thousands separators. None if not numeric."""
    m = _LEADING_NUMBER.match(s)
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def normalise_key(value: Optional[str]) -> str:
    """Grouping key: whitespace/case-insensitive, numeric-aware, None == empty."""
    if value is None:
        return ""
    s = " ".join(str(value).strip().split()).lower()
    if s == "":
        return ""
    num = _as_number(s)
    if num is not None:
        return f"num:{num!r}"
    return s


def _credible_interval(alpha: float, beta: float, mass: float = 0.9) -> tuple[float, float]:
    """Normal-approximation credible interval for Beta(alpha, beta), clipped to [0,1]."""
    total = alpha + beta
    mean = alpha / total
    var = (alpha * beta) / (total * total * (total + 1.0))
    z = NormalDist().inv_cdf(0.5 + mass / 2.0)
    margin = z * math.sqrt(var)
    return (max(0.0, mean - margin), min(1.0, mean + margin))


def fuse_field(
    samples: list[Optional[str]],
    prior_alpha: float = 1.0,
    prior_beta: float = 1.0,
    ci_mass: float = 0.9,
) -> dict:
    """Fuse k sampled values for one field into a beta-binomial posterior.

    Returns the consensus (modal) raw value, the agreement count, and the
    posterior mean + credible interval over correctness.
    """
    k = len(samples)
    if k == 0:
        mean = prior_alpha / (prior_alpha + prior_beta)
        low, high = _credible_interval(prior_alpha, prior_beta, ci_mass)
        return {
            "consensus": None,
            "agreement": 0,
            "k": 0,
            "posterior_mean": mean,
            "ci_low": low,
            "ci_high": high,
        }

    # Group by normalised key; the modal group is the consensus.
    keys = [normalise_key(s) for s in samples]
    counts = Counter(keys)
    modal_key, agreement = counts.most_common(1)[0]

    # A representative raw value from the modal group (None if the group is empty).
    consensus: Optional[str] = None
    for raw, key in zip(samples, keys):
        if key == modal_key:
            consensus = raw
            break

    post_alpha = prior_alpha + agreement
    post_beta = prior_beta + (k - agreement)
    mean = post_alpha / (post_alpha + post_beta)
    low, high = _credible_interval(post_alpha, post_beta, ci_mass)

    return {
        "consensus": consensus,
        "agreement": agreement,
        "k": k,
        "posterior_mean": mean,
        "ci_low": low,
        "ci_high": high,
    }
