from typing import Dict, Any, Tuple, List

RULESET = "dq_v2_consistency_gated"

FIELD_DOC_TYPE_HINTS = {
    "electricity_kwh": {"energy", "utility", "invoice"},
    "natural_gas_kwh": {"energy", "utility", "invoice"},
    "production_units": {"production", "packing_list", "invoice"},
}

TOLERANCE = {
    "electricity_kwh": {"abs": 50.0, "rel": 0.01},
    "natural_gas_kwh": {"abs": 50.0, "rel": 0.01},
    "production_units": {"abs": 5.0, "rel": 0.01},
}

# If there's a conflict, we DO NOT pick a number. We gate it.
CONFLICT_POLICY = {
    "action": "null_and_require_human_review",
    "suggestion_by_field": {
        "electricity_kwh": "Resolve conflict by confirming the correct electricity total for the reporting period. Prefer a utility statement or meter-based record that covers the full period.",
        "natural_gas_kwh": "Resolve conflict by confirming the correct gas total for the reporting period. Prefer a utility statement or meter-based record that covers the full period.",
        "production_units": "Resolve conflict by confirming production/dispatch volume for the reporting period. Prefer an ERP export or production report."
    }
}

def _is_conflict(values: List[float], field: str) -> Tuple[bool, Dict[str, Any]]:
    if len(values) < 2:
        return False, {"reason": "insufficient_support"}

    vmin = min(values)
    vmax = max(values)
    abs_diff = vmax - vmin
    rel_diff = abs_diff / max(abs(vmin), 1.0)

    tol = TOLERANCE.get(field, {"abs": 0.0, "rel": 0.0})
    conflict = abs_diff > tol["abs"] and rel_diff > tol["rel"]

    return conflict, {
        "min": vmin,
        "max": vmax,
        "abs_diff": abs_diff,
        "rel_diff": rel_diff,
        "tol_abs": tol["abs"],
        "tol_rel": tol["rel"],
    }

def score_extraction_consistency(
    per_doc_values: List[Dict[str, Any]],
    doc_types_present: set[str],
) -> Tuple[float, Dict[str, float], Dict[str, Any], Dict[str, Any]]:
    candidates: Dict[str, List[Dict[str, Any]]] = {k: [] for k in FIELD_DOC_TYPE_HINTS.keys()}

    for item in per_doc_values:
        vals = item.get("values", {})
        for field in candidates.keys():
            v = vals.get(field)
            if v is not None:
                candidates[field].append({
                    "doc_id": item.get("doc_id"),
                    "filename": item.get("filename"),
                    "doc_type": item.get("doc_type"),
                    "value": float(v),
                })

    field_conf: Dict[str, float] = {}
    canonical: Dict[str, Any] = {}
    conflicts: List[Dict[str, Any]] = []
    conflict_fields = set()

    for field, items in candidates.items():
        if not items:
            field_conf[field] = 0.0
            canonical[field] = None
            continue

        values = [i["value"] for i in items]
        support_count = len(values)

        conflict, conflict_meta = _is_conflict(values, field)
        if conflict:
            conflict_fields.add(field)
            conflicts.append({
                "field": field,
                "candidates": items,
                "analysis": conflict_meta,
                "resolution_suggestion": CONFLICT_POLICY["suggestion_by_field"].get(field, "Resolve conflicting values with supplier evidence."),
            })
            # Gate: do NOT output a canonical number if conflict exists
            canonical[field] = None
        else:
            # choose canonical value: median (safe when consistent)
            values_sorted = sorted(values)
            mid = support_count // 2
            median = values_sorted[mid] if support_count % 2 == 1 else (values_sorted[mid - 1] + values_sorted[mid]) / 2.0
            canonical[field] = median

        # confidence scoring (deterministic)
        score = 0.75

        if doc_types_present.intersection(FIELD_DOC_TYPE_HINTS[field]):
            score += 0.05

        if support_count >= 2:
            score += 0.10

        if conflict:
            score = 0.30
        else:
            score += 0.05

        score = min(score, 0.95)
        field_conf[field] = score

    overall = (sum(field_conf.values()) / max(len(field_conf), 1)) * 100.0
    overall = round(overall, 2)

    quality_meta = {
        "ruleset": RULESET,
        "doc_types_present": sorted(list(doc_types_present)),
        "support_count": {f: len(candidates[f]) for f in candidates.keys()},
        "field_confidence": field_conf,
        "overall_confidence": overall,
        "conflicts": conflicts,
        "conflict_fields": sorted(list(conflict_fields)),
        "requires_human_review": len(conflicts) > 0,
        "conflict_policy": CONFLICT_POLICY,
        "candidates": candidates,
    }

    return overall, field_conf, quality_meta, canonical
