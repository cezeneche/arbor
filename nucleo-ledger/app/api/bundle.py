from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from app.db.session import engine

router = APIRouter()

def _safe_get(d, *keys, default=None):
    cur = d
    for k in keys:
        if cur is None or not isinstance(cur, dict) or k not in cur:
            return default
        cur = cur[k]
    return cur

@router.get("/cases/{case_id}/bundle")
def case_bundle(case_id: str, audit_limit: int = 20):
    with engine.begin() as conn:
        case = conn.execute(
            text("""
                SELECT id, supplier_name, supplier_country,
                       reporting_period_start, reporting_period_end,
                       external_ref, status, created_at
                FROM cases
                WHERE id = :case_id
            """),
            {"case_id": case_id},
        ).mappings().fetchone()

        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        documents = conn.execute(
            text("""
                SELECT id, filename, mime_type, storage_uri, sha256, doc_type, uploaded_at
                FROM documents
                WHERE case_id = :case_id
                ORDER BY uploaded_at ASC
            """),
            {"case_id": case_id},
        ).mappings().all()

        extraction = conn.execute(
            text("""
                SELECT id, version, extracted_json, extraction_confidence, created_at
                FROM extractions
                WHERE case_id = :case_id
                ORDER BY version DESC
                LIMIT 1
            """),
            {"case_id": case_id},
        ).mappings().fetchone()

        calculation = conn.execute(
            text("""
                SELECT id, version, method_version, results_json, created_at
                FROM calculations
                WHERE case_id = :case_id
                ORDER BY version DESC
                LIMIT 1
            """),
            {"case_id": case_id},
        ).mappings().fetchone()

        audit = conn.execute(
            text("""
                SELECT id, event_type, actor_type, event_json, created_at
                FROM audit_log
                WHERE case_id = :case_id
                ORDER BY created_at DESC
                LIMIT :limit
            """),
            {"case_id": case_id, "limit": audit_limit},
        ).mappings().all()

    extraction_dict = dict(extraction) if extraction else None
    calculation_dict = dict(calculation) if calculation else None

    results_json = calculation_dict.get("results_json") if calculation_dict else None

    quality = _safe_get(extraction_dict, "extracted_json", "__quality", default={}) if extraction_dict else {}
    conflicts = quality.get("conflicts") or []
    conflict_fields = quality.get("conflict_fields") or []
    resolved_conflicts = quality.get("resolved_conflicts") or []

    latest_resolution = None
    if resolved_conflicts:
        # last resolved conflict in list (append-order)
        rc = resolved_conflicts[-1]
        res = rc.get("resolution") or {}
        latest_resolution = {
            "field": res.get("field") or rc.get("field"),
            "chosen_value": res.get("chosen_value"),
            "chosen_source_doc_id": res.get("chosen_source_doc_id"),
            "resolved_at": res.get("resolved_at"),
            "rationale": res.get("rationale"),
        }

    bundle_summary = {
        "case_id": case_id,
        "versions": {
            "latest_extraction_version": extraction_dict.get("version") if extraction_dict else None,
            "latest_calculation_version": calculation_dict.get("version") if calculation_dict else None,
        },
        "overall_confidence": float(extraction_dict["extraction_confidence"])
        if extraction_dict and extraction_dict.get("extraction_confidence") is not None else None,
        "totals": {
            "total_kgco2e": _safe_get(results_json, "package", "results", "total_kgco2e"),
            "kgco2e_per_unit": _safe_get(results_json, "package", "results", "kgco2e_per_unit"),
        },
        "factor_set": {
            "name": _safe_get(results_json, "factor_set", "name"),
            "sha256": _safe_get(results_json, "factor_set", "sha256"),
            "unit": _safe_get(results_json, "factor_set", "unit"),
        },
        "method_versions": {
            "calculation_method_version": calculation_dict.get("method_version") if calculation_dict else None,
            "extraction_method_ruleset": quality.get("ruleset"),
        },
        "gating": {
            "requires_human_review": bool(quality.get("requires_human_review")) if quality else False,
            "conflict_fields": conflict_fields,
            "conflict_count": len(conflicts),
            "resolved_conflict_count": len(resolved_conflicts),
            "resolution_policy": quality.get("resolution_policy"),
            "latest_resolution": latest_resolution,
        },
    }

    return {
        "bundle_summary": bundle_summary,
        "case": dict(case),
        "documents": [dict(d) for d in documents],
        "latest_extraction": extraction_dict,
        "latest_calculation": calculation_dict,
        "audit_tail": [dict(a) for a in audit],
    }
