import hashlib
import json
from fastapi import APIRouter, UploadFile, File, HTTPException
from sqlalchemy import text
from app.db.session import engine
from app.services.storage import get_s3_client, S3_BUCKET

router = APIRouter()

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

@router.post("/cases/{case_id}/documents/upload")
async def upload_document(case_id: str, file: UploadFile = File(...), doc_type: str = "other"):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    checksum = sha256_bytes(data)

    # Upload to MinIO
    key = f"cases/{case_id}/raw/{file.filename}"
    s3 = get_s3_client()
    s3.put_object(Bucket=S3_BUCKET, Key=key, Body=data)

    storage_uri = f"s3://{S3_BUCKET}/{key}"

    with engine.begin() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM cases WHERE id = :id"),
            {"id": case_id},
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Case not found")

        row = conn.execute(
            text("""
                INSERT INTO documents (case_id, filename, mime_type, storage_uri, sha256, doc_type)
                VALUES (:case_id, :filename, :mime_type, :storage_uri, :sha256, :doc_type)
                RETURNING id, case_id, filename, storage_uri, sha256, doc_type, uploaded_at
            """),
            {
                "case_id": case_id,
                "filename": file.filename,
                "mime_type": file.content_type,
                "storage_uri": storage_uri,
                "sha256": checksum,
                "doc_type": doc_type,
            },
        ).mappings().one()

        event_json = json.dumps({
            "filename": file.filename,
            "doc_type": doc_type,
            "storage_uri": storage_uri,
        })

        conn.execute(
            text("""
                INSERT INTO audit_log (case_id, event_type, actor_type, event_json)
                VALUES (:case_id, 'doc_uploaded', 'human', CAST(:event_json AS jsonb))
            """),
            {
                "case_id": case_id,
                "event_json": event_json,
            },
        )

    return dict(row)
