"""Upgrade 10 — differential privacy on cross-tenant aggregates (pure stdlib).

Arbor can publish sector statistics (e.g. median emissions intensity per commodity
per country per quarter) computed across many tenants. Published naively, an
aggregate can leak an individual contributor — especially in a thin group. ε-
differential privacy bounds that: the released number is calibrated Laplace noise
added to the true statistic, so no single entity's contribution is statistically
detectable, with a formal privacy budget ε.

  Laplace mechanism: to release f(D) with ε-DP, add noise ~ Laplace(Δf/ε), where
  Δf is the sensitivity — how much f can change if one entity's data changes.

The values must be clamped to a *public* range [low, high] (chosen from domain
knowledge, never from the data) so the sensitivity of a mean over n entities is
bounded by (high-low)/n. Groups below the minimum-population floor are suppressed
entirely — noise alone is not enough protection for a handful of contributors.

Dependency-free: an inverse-CDF Laplace sampler over stdlib random. A vetted DP
library (OpenDP / Google DP) is the escalation once the release vocabulary grows.
"""
from __future__ import annotations

import math
import random
from typing import Optional

_RNG = random.Random()


def laplace_scale(sensitivity: float, epsilon: float) -> float:
    """Noise scale b = Δf / ε for the Laplace mechanism."""
    if epsilon <= 0:
        raise ValueError("epsilon must be positive")
    if sensitivity < 0:
        raise ValueError("sensitivity must be non-negative")
    return sensitivity / epsilon


def laplace_sample(scale: float, rng: Optional[random.Random] = None) -> float:
    """A Laplace(0, scale) draw via inverse CDF over a uniform on (-0.5, 0.5)."""
    r = rng or _RNG
    u = r.random() - 0.5  # in [-0.5, 0.5); 1 - 2|u| in (0, 1]
    return -scale * math.copysign(1.0, u) * math.log(1.0 - 2.0 * abs(u))


def dp_mean(
    values: list[float],
    low: float,
    high: float,
    epsilon: float,
    rng: Optional[random.Random] = None,
) -> float:
    """ε-DP mean of `values`, each first clamped to the public range [low, high]."""
    n = len(values)
    if n == 0:
        return 0.0
    clamped = [min(high, max(low, v)) for v in values]
    true_mean = math.fsum(clamped) / n
    sensitivity = (high - low) / n
    return true_mean + laplace_sample(laplace_scale(sensitivity, epsilon), rng)


def dp_count(true_count: int, epsilon: float, rng: Optional[random.Random] = None) -> float:
    """ε-DP count (sensitivity 1)."""
    return true_count + laplace_sample(laplace_scale(1.0, epsilon), rng)


def release(
    values: list[float],
    low: float,
    high: float,
    epsilon: float,
    min_n: int = 10,
    rng: Optional[random.Random] = None,
) -> dict:
    """Release an ε-DP mean + count for a group, or suppress it below the floor."""
    n = len(values)
    if n < min_n:
        return {"suppressed": True, "n": n,
                "reason": f"below minimum population floor ({min_n})"}
    return {
        "suppressed": False,
        "n": n,
        "dp_mean": dp_mean(values, low, high, epsilon, rng),
        "dp_count": dp_count(n, epsilon, rng),
        "epsilon": epsilon,
        "bounds": [low, high],
    }
