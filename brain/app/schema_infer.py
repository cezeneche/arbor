"""Upgrade 2 — schema inference from field co-occurrence (pure stdlib).

The second application of the information-theory primitives. Given a corpus of
documents each represented by the set of field names extracted from it, decide
how those fields group into a schema that preserves signal and discards noise —
mathematically, not by hand:

  - core   : fields present in (nearly) every document — the schema backbone.
  - groups : sets of fields that co-vary (high mutual information in their
             presence/absence) — they belong together in the schema.
  - noise  : fields that almost never appear — likely extraction noise, not part
             of the schema.

Mutual information between two fields' presence is 0 exactly when they appear
independently, and large when they appear (or vanish) together. A field that is
always present carries no *co-variation* signal, so it is classified by its
presence rate as core rather than judged by MI. Reuses infotheory.mutual_information.
"""
from __future__ import annotations

from .infotheory import mutual_information


def pairwise_mutual_information(docs: list[list[str]], fields: list[str]) -> list[dict]:
    """MI (bits) between each field pair's presence across the documents."""
    present = [set(d) for d in docs]
    out: list[dict] = []
    for i in range(len(fields)):
        for j in range(i + 1, len(fields)):
            a, b = fields[i], fields[j]
            joint = [[0, 0], [0, 0]]
            for p in present:
                joint[1 if a in p else 0][1 if b in p else 0] += 1
            out.append({"a": a, "b": b, "mi": mutual_information(joint)})
    return out


def _connected_components(nodes: list[str], edges: list[tuple[str, str]]) -> list[list[str]]:
    """Union-find over `nodes`, grouping any that are joined by an edge."""
    parent = {n: n for n in nodes}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in edges:
        parent[find(a)] = find(b)

    groups: dict[str, list[str]] = {}
    for n in nodes:
        groups.setdefault(find(n), []).append(n)
    return [sorted(v) for v in groups.values()]


def infer_schema(
    docs: list[list[str]],
    mi_threshold: float = 0.05,
    core_rate: float = 0.9,
    noise_rate: float = 0.1,
) -> dict:
    """Classify fields into core / grouped / noise from their co-occurrence."""
    n = len(docs)
    if n == 0:
        return {"core": [], "groups": [], "noise": [], "pairs": []}

    present = [set(d) for d in docs]
    fields = sorted({f for p in present for f in p})
    rate = {f: sum(1 for p in present if f in p) / n for f in fields}

    core = sorted(f for f in fields if rate[f] >= core_rate)
    noise = sorted(f for f in fields if rate[f] <= noise_rate)
    classified = set(core) | set(noise)
    variable = [f for f in fields if f not in classified]

    all_pairs = pairwise_mutual_information(docs, fields)
    # Build edges only among variable fields whose presence is above the MI threshold.
    variable_set = set(variable)
    edges = [
        (p["a"], p["b"])
        for p in all_pairs
        if p["mi"] >= mi_threshold and p["a"] in variable_set and p["b"] in variable_set
    ]
    groups = [g for g in _connected_components(variable, edges) if len(g) >= 2]

    return {"core": core, "groups": groups, "noise": noise, "pairs": all_pairs}
