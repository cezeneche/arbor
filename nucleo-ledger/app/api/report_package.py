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

@router.get("/cases/{case_id}/report-package")
def report_package(case_id: str, audit_limit: int = 25, gap_confidence_threshold: float = 95.0):
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

    if not extraction_dict:
        raise HTTPException(status_code=404, detail="No extraction yet for this case")

    if not calculation_dict:
        raise HTTPException(status_code=404, detail="No calculation yet for this case")

    extracted_json = extraction_dict.get("extracted_json") or {}
    quality = extracted_json.get("__quality") or {}
    results_json = calculation_dict.get("results_json") or {}

    # Gating summary (top-level, reviewer friendly)
    conflicts = quality.get("conflicts") or []
    conflict_fields = quality.get("conflict_fields") or []
    resolved_conflicts = quality.get("resolved_conflicts") or []

    latest_resolution = None
    if resolved_conflicts:
        rc = resolved_conflicts[-1]
        res = rc.get("resolution") or {}
        latest_resolution = {
            "field": res.get("field") or rc.get("field"),
            "chosen_value": res.get("chosen_value"),
            "chosen_source_doc_id": res.get("chosen_source_doc_id"),
            "resolved_at": res.get("resolved_at"),
            "rationale": res.get("rationale"),
        }

    gating = {
        "requires_human_review": bool(quality.get("requires_human_review")) if quality else False,
        "conflict_fields": conflict_fields,
        "conflict_count": len(conflicts),
        "resolved_conflict_count": len(resolved_conflicts),
        "resolution_policy": quality.get("resolution_policy"),
        "latest_resolution": latest_resolution,
    }

    # Open gaps (simple, derived from confidence threshold)
    # Note: For now we only evaluate the 3 key fields we currently extract.
    field_conf = quality.get("field_confidence") or {}
    key_fields = [
        ("electricity_kwh", "Electricity consumption (kWh)"),
        ("natural_gas_kwh", "Natural gas consumption (kWh)"),
        ("production_units", "Production volume (units)"),
    ]
    open_gaps = []
    for f, label in key_fields:
        v = extracted_json.get(f)
        fc = field_conf.get(f)
        if v is None:
            open_gaps.append({"field": f, "label": label, "issue": "missing_value"})
        elif fc is not None and float(fc) * 100.0 < gap_confidence_threshold:
            open_gaps.append({
                "field": f,
                "label": label,
                "issue": "low_confidence",
                "current_confidence": round(float(fc) * 100.0, 2),
                "target_confidence": gap_confidence_threshold,
            })

    # Build the LLM-safe packet
    packet = {
        "type": "report_package_v1",
        "case": dict(case),
        "artifacts": {
            "latest_extraction": {
                "id": str(extraction_dict["id"]),
                "version": int(extraction_dict["version"]),
                "created_at": extraction_dict.get("created_at"),
                "extraction_confidence": float(extraction_dict["extraction_confidence"])
                if extraction_dict.get("extraction_confidence") is not None else None,
            },
            "latest_calculation": {
                "id": str(calculation_dict["id"]),
                "version": int(calculation_dict["version"]),
                "created_at": calculation_dict.get("created_at"),
                "method_version": calculation_dict.get("method_version"),
            },
        },
        "inputs": {
            "electricity_kwh": extracted_json.get("electricity_kwh"),
            "natural_gas_kwh": extracted_json.get("natural_gas_kwh"),
            "production_units": extracted_json.get("production_units"),
        },
        "results": _safe_get(results_json, "package", "results", default={}),
        "factors": _safe_get(results_json, "factor_set", default={}),
        "data_quality": {
            "ruleset": quality.get("ruleset"),
            "overall_confidence": quality.get("overall_confidence"),
            "field_confidence": quality.get("field_confidence"),
            "doc_types_present": quality.get("doc_types_present"),
            "support_count": quality.get("support_count"),
            "gating": gating,
        },
        "documents": [
            {
                "id": str(d["id"]),
                "filename": d["filename"],
                "doc_type": d.get("doc_type"),
                "mime_type": d.get("mime_type"),
                "storage_uri": d.get("storage_uri"),
                "sha256": d.get("sha256"),
                "uploaded_at": d.get("uploaded_at"),
            }
            for d in documents
        ],
        "audit_tail": [
            {
                "id": str(a["id"]),
                "event_type": a["event_type"],
                "actor_type": a["actor_type"],
                "created_at": a["created_at"],
                "event_json": a.get("event_json"),
            }
            for a in audit
        ],
        "open_gaps": open_gaps,
        "narrative_constraints": {
            "do_not_invent_numbers": True,
            "use_only_packet_values": True,
            "if_missing_or_low_confidence_explain": True,
        },
    }

    return packet
