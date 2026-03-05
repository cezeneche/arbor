import json
from datetime import datetime
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from ledger_app.db.session import engine
from ledger_app.services.audit_signer import get_prev_chain_hmac, sign_event

router = APIRouter()

class ConflictResolution(BaseModel):
    field: str = Field(..., description="e.g. electricity_kwh")
    chosen_value: float = Field(..., gt=0)
    chosen_source_doc_id: str | None = Field(None, description="Optional: doc_id you are trusting")
    rationale: str = Field(..., min_length=3)

def _recompute_overall_conf(field_conf: dict) -> float:
    # field_conf is 0.0–1.0 per field
    if not field_conf:
        return 0.0
    return round((sum(float(v) for v in field_conf.values()) / len(field_conf)) * 100.0, 2)

@router.post("/cases/{case_id}/resolve-conflict")
def resolve_conflict(case_id: str, payload: ConflictResolution):
    with engine.begin() as conn:
        # latest extraction
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
            raise HTTPException(status_code=404, detail="No extraction found for this case")

        extracted = extraction["extracted_json"] or {}
        quality = extracted.get("__quality") or {}

        conflict_fields = set(quality.get("conflict_fields") or [])
        if payload.field not in conflict_fields:
            raise HTTPException(
                status_code=400,
                detail=f"Field '{payload.field}' is not currently flagged as conflicting on the latest extraction.",
            )

        conflicts = quality.get("conflicts") or []
        # find the conflict object
        target_conflict = None
        remaining_conflicts = []
        for c in conflicts:
            if c.get("field") == payload.field and target_conflict is None:
                target_conflict = c
            else:
                remaining_conflicts.append(c)

        if target_conflict is None:
            raise HTTPException(status_code=400, detail="Conflict metadata not found for this field")

        # Apply the resolution: set canonical value
        extracted[payload.field] = float(payload.chosen_value)

        # Update quality metadata
        resolution_record = {
            "field": payload.field,
            "chosen_value": float(payload.chosen_value),
            "chosen_source_doc_id": payload.chosen_source_doc_id,
            "rationale": payload.rationale,
            "resolved_at": datetime.utcnow().isoformat() + "Z",
            "resolved_from_extraction": {"id": str(extraction["id"]), "version": int(extraction["version"])},
            "candidates": target_conflict.get("candidates", []),
        }

        # Mark conflict as resolved and store it for traceability
        resolved_conflicts = quality.get("resolved_conflicts") or []
        target_conflict["resolved"] = True
        target_conflict["resolution"] = resolution_record
        resolved_conflicts.append(target_conflict)

        # Remove from conflict_fields
        conflict_fields.discard(payload.field)

        # Update field confidence: after human resolution, bump but not to max
        field_conf = quality.get("field_confidence") or {}
        if payload.field in field_conf:
            field_conf[payload.field] = max(float(field_conf[payload.field]), 0.85)

        quality["field_confidence"] = field_conf
        quality["resolved_conflicts"] = resolved_conflicts
        quality["conflicts"] = remaining_conflicts
        quality["conflict_fields"] = sorted(list(conflict_fields))
        quality["requires_human_review"] = len(conflict_fields) > 0
        quality["resolution_policy"] = "human_selected_value_v1"

        # Recompute overall confidence based on field_confidence
        new_overall = _recompute_overall_conf(field_conf)
        quality["overall_confidence"] = new_overall

        extracted["__quality"] = quality

        # next extraction version
        next_version = conn.execute(
            text("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM extractions WHERE case_id = :case_id"),
            {"case_id": case_id},
        ).mappings().one()["v"]

        row = conn.execute(
            text("""
                INSERT INTO extractions (case_id, version, extracted_json, extraction_confidence)
                VALUES (:case_id, :version, CAST(:data AS jsonb), :confidence)
                RETURNING id, case_id, version, extracted_json, extraction_confidence, created_at
            """),
            {
                "case_id": case_id,
                "version": next_version,
                "data": json.dumps(extracted),
                "confidence": new_overall,
            },
        ).mappings().one()

        # audit log
        _event_json = json.dumps({
            "field": payload.field,
            "chosen_value": float(payload.chosen_value),
            "chosen_source_doc_id": payload.chosen_source_doc_id,
            "rationale": payload.rationale,
            "new_extraction_version": int(next_version),
            "previous_extraction_version": int(extraction["version"]),
        }, sort_keys=True)
        _prev_hmac = get_prev_chain_hmac(case_id, conn)
        _sig = sign_event(case_id, "conflict_resolved", "system", _event_json,
                          prev_hmac=_prev_hmac)
        conn.execute(
            text("""
                INSERT INTO audit_log
                    (case_id, event_type, actor_type, actor_sub, event_json,
                     hmac_sha256, prev_hmac)
                VALUES
                    (:case_id, 'conflict_resolved', 'human', 'system',
                     CAST(:event_json AS jsonb), :sig, :prev_hmac)
            """),
            {
                "case_id": case_id,
                "event_json": _event_json,
                "sig": _sig,
                "prev_hmac": _prev_hmac,
            },
        )

    return dict(row)
