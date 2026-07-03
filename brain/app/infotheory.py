"""Upgrade 2 — information theory primitives (pure stdlib).

Two applications ride on these: (a) schema inference at intake — group fields so
the schema preserves signal (mutual information) and discards noise; (b) active
learning at review — rank which field to ask the human to confirm next by
expected information gain, so Arbor stops asking about fields whose confirmation
adds nothing and SME review burden falls.

Everything here is base-2 (bits) and dependency-free — no scipy, no numpy. The
distributions are tiny (a handful of field values / outcomes) and the maths is
transparent, which matters more than speed. Inputs are normalised defensively so
callers can pass raw counts or probabilities.
"""
from __future__ import annotations

import math


def _normalise(weights: list[float]) -> list[float]:
    """Turn non-negative counts/probabilities into a probability vector. Empty or
    all-zero input yields an empty distribution (entropy 0)."""
    total = math.fsum(weights)
    if total <= 0:
        return []
    return [w / total for w in weights if w > 0]


def entropy(dist: list[float]) -> float:
    """Shannon entropy H(X) in bits. Accepts counts or probabilities; normalises."""
    probs = _normalise(dist)
    return -math.fsum(p * math.log2(p) for p in probs)


def binary_entropy(p: float) -> float:
    """Entropy of a Bernoulli(p) in bits. H(0) = H(1) = 0, H(0.5) = 1."""
    if p <= 0.0 or p >= 1.0:
        return 0.0
    return -(p * math.log2(p) + (1.0 - p) * math.log2(1.0 - p))


def mutual_information(joint: list[list[float]]) -> float:
    """Mutual information I(X;Y) in bits from a joint distribution matrix.

    `joint[i][j]` is the (unnormalised) weight of X=i, Y=j. I = 0 exactly when X
    and Y are independent; I = H(X) when Y determines X.
    """
    total = math.fsum(math.fsum(row) for row in joint)
    if total <= 0:
        return 0.0

    row_marg = [math.fsum(row) / total for row in joint]
    n_cols = max((len(row) for row in joint), default=0)
    col_marg = [
        math.fsum(joint[i][j] for i in range(len(joint)) if j < len(joint[i])) / total
        for j in range(n_cols)
    ]

    mi = 0.0
    for i, row in enumerate(joint):
        for j, w in enumerate(row):
            if w <= 0:
                continue
            pij = w / total
            denom = row_marg[i] * col_marg[j]
            if denom > 0:
                mi += pij * math.log2(pij / denom)
    # Clamp tiny negative drift from floating point; MI is non-negative.
    return max(0.0, mi)
