"""Upgrade 9 — graph flow consistency across the supply chain (pure stdlib).

The fraud-detection layer only Arbor can build, because only Arbor holds the
multi-buyer, multi-supplier graph. Two checks, both cross-tenant:

  1. Flow conservation. Treat the supply chain as a directed flow network over
     the Upgrade-4 graph. At each node, Kirchhoff-style: what flows in (incoming
     edges + local supply/production) must cover what flows out (outgoing edges +
     local consumption). A node that sends out more than it could ever have is
     physically impossible — an impossible-capacity claim.

  2. Double counting. The same lot or (single-use) certificate claimed by two
     buyers, or a reference whose total allocated quantity exceeds its capacity —
     the low-emission-certificate laundering nobody sees from one tenant's books.

Runs offline as an anomaly detector, never in the write path. Dependency-free:
the baseline is aggregation + comparison; a full LP feasibility formulation
(pulp/cvxpy over NetworkX) is the escalation if node-level balances need it.
"""
from __future__ import annotations

from typing import Optional


def check_conservation(
    nodes: list[dict],
    edges: list[dict],
    tolerance: float = 0.05,
) -> list[dict]:
    """Flag nodes whose flow does not balance.

    node: {id, supply?, demand?}; edge: {source, target, quantity}. `available` =
    incoming edge flow + supply; `used` = outgoing edge flow + demand.
    """
    inflow: dict[str, float] = {}
    outflow: dict[str, float] = {}
    for e in edges:
        q = e.get("quantity", 0.0)
        outflow[e["source"]] = outflow.get(e["source"], 0.0) + q
        inflow[e["target"]] = inflow.get(e["target"], 0.0) + q

    out: list[dict] = []
    for n in nodes:
        nid = n["id"]
        available = inflow.get(nid, 0.0) + n.get("supply", 0.0)
        used = outflow.get(nid, 0.0) + n.get("demand", 0.0)
        scale = max(available, used, 1.0)
        if used > available * (1.0 + tolerance):
            out.append({
                "node": nid, "type": "OVERDRAW", "available": available, "used": used,
                "message": f"node {nid} sends out/consumes {used:g} but only {available:g} is available",
            })
        elif abs(available - used) / scale > tolerance:
            out.append({
                "node": nid, "type": "IMBALANCE", "available": available, "used": used,
                "message": f"node {nid} flow imbalance: {available:g} in vs {used:g} out",
            })
    return out


def detect_double_counting(claims: list[dict], tolerance: float = 0.05) -> list[dict]:
    """Flag references claimed beyond what exists.

    claim: {ref, claimant, quantity?, capacity?}. A ref with a capacity is
    over-allocated when the total claimed exceeds it. A ref without a capacity is
    treated as single-use (e.g. a certificate): any claim by more than one party
    is double counting.
    """
    by_ref: dict[str, list[dict]] = {}
    for c in claims:
        by_ref.setdefault(c["ref"], []).append(c)

    out: list[dict] = []
    for ref in sorted(by_ref):
        cs = by_ref[ref]
        claimants = sorted({c["claimant"] for c in cs})
        total = sum(c.get("quantity", 0.0) for c in cs)
        capacity: Optional[float] = next(
            (c["capacity"] for c in cs if c.get("capacity") is not None), None
        )
        if capacity is not None and total > capacity * (1.0 + tolerance):
            out.append({
                "ref": ref, "type": "OVER_ALLOCATION", "claimants": claimants,
                "total": total, "capacity": capacity,
                "message": f"{ref} allocated {total:g} across {len(claimants)} parties, capacity {capacity:g}",
            })
        elif capacity is None and len(claimants) > 1:
            out.append({
                "ref": ref, "type": "DOUBLE_COUNTED", "claimants": claimants,
                "total": total, "capacity": None,
                "message": f"{ref} claimed by {len(claimants)} parties: {', '.join(claimants)}",
            })
    return out
