import hashlib
import json
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from slowapi import Limiter
from ledger_app.core.rate_limit import user_or_ip_key
from sqlalchemy import text
from ledger_app.db.session import engine
from ledger_app.services.storage import get_s3_client, S3_BUCKET
from ledger_app.services.audit_signer import sign_event

router = APIRouter()
_limiter = Limiter(key_func=user_or_ip_key)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _verify_case_access(conn, case_id: str, auth) -> None:
    """Raise 404 if case missing; 403 if caller lacks access."""
    row = conn.execute(
        text("SELECT owner_sub, tenant_id FROM cases WHERE id = :id"),
        {"id": case_id},
    ).mappings().one_or_none()

    if row is None:
        raise HTTPException(status_code=404, detail="Case not found")

    if auth is None:
        return  # test mode — allow

    if "cbam:admin" in (auth.scopes or []):
        return  # admin bypass

    if not row["owner_sub"] or row["owner_sub"] == auth.sub:
        return  # owner or legacy row

    acl = conn.execute(
        text("SELECT 1 FROM case_acl WHERE case_id = :cid AND sub = :sub LIMIT 1"),
        {"cid": case_id, "sub": auth.sub},
    ).fetchone()
    if acl:
        return

    raise HTTPException(status_code=403, detail="Forbidden")


@router.post("/cases/{case_id}/documents/upload")
@_limiter.limit("10/minute")
async def upload_document(
    request: Request,
    case_id: str,
    file: UploadFile = File(...),
    doc_type: str = "other",
):
    auth = getattr(request.state, "auth_context", None)
    actor_sub = auth.sub if auth else "system"

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    checksum = sha256_bytes(data)
    key = f"cases/{case_id}/raw/{file.filename}"

    s3 = get_s3_client()
    s3.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=data,
        ServerSideEncryption="AES256",  # S4c: SSE on all uploads
    )

    storage_uri = f"s3://{S3_BUCKET}/{key}"

    with engine.begin() as conn:
        _verify_case_access(conn, case_id, auth)

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

        event_json = json.dumps(
            {"filename": file.filename, "doc_type": doc_type, "storage_uri": storage_uri},
            sort_keys=True,
        )
        sig = sign_event(case_id, "doc_uploaded", actor_sub, event_json)

        conn.execute(
            text("""
                INSERT INTO audit_log (case_id, event_type, actor_type, actor_sub, event_json, hmac_sha256)
                VALUES (:case_id, 'doc_uploaded', 'human', :actor_sub, CAST(:event_json AS jsonb), :sig)
            """),
            {
                "case_id": case_id,
                "actor_sub": actor_sub,
                "event_json": event_json,
                "sig": sig,
            },
        )

    return dict(row)
