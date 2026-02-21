from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from app.db.session import engine

router = APIRouter()

FIELD_HINTS = {
    "electricity_kwh": {
        "label": "Electricity consumption (kWh)",
        "recommended_docs": ["electricity bill", "utility invoice", "meter reading", "energy statement"],
        "recommended_doc_types": ["energy", "utility", "invoice"],
        "question": "Please share your electricity usage for the reporting period (kWh) with a supporting bill/statement."
    },
    "natural_gas_kwh": {
        "label": "Natural gas consumption (kWh)",
        "recommended_docs": ["gas bill", "utility invoice", "meter reading", "energy statement"],
        "recommended_doc_types": ["energy", "utility", "invoice"],
        "question": "Please share your natural gas usage for the reporting period (kWh) with a supporting bill/statement."
    },
    "production_units": {
        "label": "Production volume (units)",
        "recommended_docs": ["production report", "ERP export", "dispatch notes", "packing list"],
        "recommended_doc_types": ["production", "packing_list", "invoice"],
        "question": "Please confirm total units produced/supplied in the reporting period, ideally from a production report or ERP export."
    },
}

@router.get("/cases/{case_id}/gaps")
def gaps(case_id: str, confidence_threshold: float = 80.0):
    with engine.begin() as conn:
        # ensure case exists
        case = conn.execute(
            text("SELECT id, supplier_name FROM cases WHERE id = :case_id"),
            {"case_id": case_id},
        ).mappings().fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        # latest extraction
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

        if not extraction:
            raise HTTPException(status_code=404, detail="No extraction found for this case")

        # doc types present
        doc_types = conn.execute(
            text("SELECT DISTINCT doc_type FROM documents WHERE case_id = :case_id"),
            {"case_id": case_id},
        ).fetchall()
        doc_types_present = sorted({r[0] for r in doc_types if r and r[0]})

    extracted = extraction["extracted_json"] or {}
    quality = extracted.get("__quality") or {}
    field_conf = (quality.get("field_confidence") or {})

    missing = []
    low_conf = []

    for field, meta in FIELD_HINTS.items():
        val = extracted.get(field)
        if val is None:
            missing.append({
                "field": field,
                "label": meta["label"],
                "why_it_matters": "Missing primary activity data reduces audit defensibility and forces estimates.",
                "recommended_doc_types": meta["recommended_doc_types"],
                "recommended_docs_examples": meta["recommended_docs"],
                "supplier_request": meta["question"],
            })
        else:
            # field_conf stored as 0.0–1.0; convert to 0–100
            fc = field_conf.get(field)
            if fc is not None:
                fc100 = float(fc) * 100.0
                if fc100 < confidence_threshold:
                    low_conf.append({
                        "field": field,
                        "label": meta["label"],
                        "current_confidence": round(fc100, 2),
                        "target_confidence": confidence_threshold,
                        "recommended_doc_types": meta["recommended_doc_types"],
                        "recommended_docs_examples": meta["recommended_docs"],
                        "supplier_request": meta["question"],
                    })

    overall = extraction.get("extraction_confidence")
    overall = float(overall) if overall is not None else None

    # If confidence is already strong and nothing is missing, return a clean "no gaps"
    if not missing and not low_conf:
        return {
            "case_id": case_id,
            "supplier_name": case["supplier_name"],
            "extraction": {
                "id": str(extraction["id"]),
                "version": int(extraction["version"]),
                "overall_confidence": overall,
            },
            "doc_types_present": doc_types_present,
            "status": "no_material_gaps",
            "message": "No missing fields and all key fields meet the confidence threshold.",
            "missing_fields": [],
            "low_confidence_fields": [],
            "next_best_supplier_requests": [],
        }

    # Build actionable next-best requests (prioritise missing first, then low confidence)
    next_requests = []
    for item in missing + low_conf:
        next_requests.append({
            "field": item["field"],
            "request": item["supplier_request"],
            "suggested_evidence": item["recommended_docs_examples"],
        })

    # Also suggest which doc types are missing overall (helps ops teams)
    recommended_types = sorted({t for f in FIELD_HINTS.values() for t in f["recommended_doc_types"]})
    missing_doc_types = [t for t in recommended_types if t not in doc_types_present]

    return {
        "case_id": case_id,
        "supplier_name": case["supplier_name"],
        "extraction": {
            "id": str(extraction["id"]),
            "version": int(extraction["version"]),
            "overall_confidence": overall,
            "ruleset": quality.get("ruleset"),
        },
        "doc_types_present": doc_types_present,
        "missing_doc_types_overall": missing_doc_types,
        "confidence_threshold": confidence_threshold,
        "missing_fields": missing,
        "low_confidence_fields": low_conf,
        "next_best_supplier_requests": next_requests,
    }
