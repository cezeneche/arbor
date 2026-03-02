import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from ledger_app.db.session import engine
from ledger_app.services.calculation_service import calculate_from_extraction, load_factor_set, FACTOR_SET_PATH_DEFAULT

router = APIRouter()

@router.post("/cases/{case_id}/calculate")
def calculate_case(case_id: str):
    factor_set_path = FACTOR_SET_PATH_DEFAULT
    factor_set, factor_set_hash = load_factor_set(Path(factor_set_path))

    with engine.begin() as conn:
        extraction = conn.execute(
            text("""
                SELECT id, version, extracted_json, extraction_confidence
                FROM extractions
                WHERE case_id = :case_id
                ORDER BY version DESC
                LIMIT 1
            """),
            {"case_id": case_id},
        ).mappings().fetchone()

        if not extraction:
            raise HTTPException(status_code=404, detail="No extraction found for this case. Run POST /api/cases/{case_id}/extract first.")

        quality = (extraction["extracted_json"] or {}).get("__quality") or {}
        if quality.get("requires_human_review") is True:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Extraction is gated for human review due to conflicts. Resolve conflicts before calculating.",
                    "conflict_fields": quality.get("conflict_fields", []),
                    "conflicts": quality.get("conflicts", []),
                },
            )

        next_version = conn.execute(
            text("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM calculations WHERE case_id = :case_id"),
            {"case_id": case_id},
        ).mappings().one()["v"]

        package = calculate_from_extraction(extraction["extracted_json"], factor_set)

        dq = package.get("data_quality", {})
        dq["extraction_confidence"] = float(extraction["extraction_confidence"]) if extraction["extraction_confidence"] is not None else None
        package["data_quality"] = dq

        results_json = json.dumps({
            "source_extraction": {
                "id": str(extraction["id"]),
                "version": int(extraction["version"]),
                "extraction_confidence": float(extraction["extraction_confidence"]) if extraction["extraction_confidence"] is not None else None,
            },
            "factor_set": {
                "name": factor_set.get("name"),
                "path": str(factor_set_path),
                "sha256": factor_set_hash,
                "unit": factor_set.get("unit"),
            },
            "package": package,
        })

        row = conn.execute(
            text("""
                INSERT INTO calculations (case_id, version, method_version, results_json)
                VALUES (:case_id, :version, :method_version, CAST(:results_json AS jsonb))
                RETURNING id, case_id, version, method_version, results_json, created_at
            """),
            {
                "case_id": case_id,
                "version": next_version,
                "method_version": "calc_v3_gated_on_conflicts",
                "results_json": results_json,
            },
        ).mappings().one()

        conn.execute(
            text("""
                INSERT INTO audit_log (case_id, event_type, actor_type, event_json)
                VALUES (:case_id, 'calculated', 'system', CAST(:event_json AS jsonb))
            """),
            {
                "case_id": case_id,
                "event_json": json.dumps({
                    "calculation_version": int(next_version),
                    "method_version": "calc_v3_gated_on_conflicts",
                    "source_extraction_version": int(extraction["version"]),
                    "extraction_confidence": float(extraction["extraction_confidence"]) if extraction["extraction_confidence"] is not None else None,
                    "factor_set_name": factor_set.get("name"),
                    "factor_set_sha256": factor_set_hash,
                }),
            },
        )

    return dict(row)
