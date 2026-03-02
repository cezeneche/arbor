import json
from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from ledger_app.db.session import engine
from ledger_app.services.storage import download_bytes
from ledger_app.services.extraction_service import deterministic_extract
from ledger_app.services.data_quality_service import score_extraction_consistency

router = APIRouter()

def _key_from_storage_uri(storage_uri: str) -> str:
    parts = storage_uri.split("/", 3)
    if len(parts) < 4:
        raise ValueError(f"Invalid storage_uri: {storage_uri}")
    return parts[3]

@router.post("/cases/{case_id}/extract")
def extract_case(case_id: str):
    with engine.begin() as conn:
        case = conn.execute(
            text("SELECT id FROM cases WHERE id = :case_id"),
            {"case_id": case_id},
        ).mappings().fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        docs = conn.execute(
            text("""
                SELECT id, filename, mime_type, storage_uri, doc_type
                FROM documents
                WHERE case_id = :case_id
                ORDER BY uploaded_at ASC
            """),
            {"case_id": case_id},
        ).mappings().all()

        if not docs:
            raise HTTPException(status_code=404, detail="No documents found for this case")

        doc_types_present = {d["doc_type"] for d in docs if d.get("doc_type")}

    per_doc_values = []
    skipped = []

    for d in docs:
        try:
            key = _key_from_storage_uri(d["storage_uri"])
            raw = download_bytes(key)

            # v1: only robustly supports text-like files; PDFs/images later
            text_content = None
            if (d.get("mime_type") or "").startswith("text/") or (d.get("filename") or "").lower().endswith((".txt", ".csv")):
                text_content = raw.decode("utf-8", errors="ignore")
            else:
                skipped.append({
                    "doc_id": str(d["id"]),
                    "filename": d["filename"],
                    "mime_type": d.get("mime_type"),
                    "reason": "non_text_not_supported_in_v1",
                })
                continue

            vals = deterministic_extract(text_content)

            per_doc_values.append({
                "doc_id": str(d["id"]),
                "filename": d["filename"],
                "doc_type": d.get("doc_type"),
                "values": vals,
            })
        except Exception as e:
            skipped.append({
                "doc_id": str(d.get("id")),
                "filename": d.get("filename"),
                "reason": f"error: {type(e).__name__}",
            })

    # Score consistency + choose canonical values
    overall_conf, field_scores, quality_meta, canonical = score_extraction_consistency(per_doc_values, doc_types_present)

    # Attach extraction diagnostics
    quality_meta["skipped_docs"] = skipped

    extracted_payload = dict(canonical)
    extracted_payload["__quality"] = quality_meta

    with engine.begin() as conn:
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
                "data": json.dumps(extracted_payload),
                "confidence": overall_conf,
            },
        ).mappings().one()

        conn.execute(
            text("""
                INSERT INTO audit_log (case_id, event_type, actor_type, event_json)
                VALUES (:case_id, 'extracted', 'system', CAST(:event_json AS jsonb))
            """),
            {
                "case_id": case_id,
                "event_json": json.dumps({
                    "version": int(next_version),
                    "method": "deterministic_v2_per_doc",
                    "dq_ruleset": quality_meta["ruleset"],
                    "extraction_confidence": overall_conf,
                    "field_confidence": field_scores,
                    "conflict_count": len(quality_meta.get("conflicts", [])),
                }),
            },
        )

    return dict(row)
