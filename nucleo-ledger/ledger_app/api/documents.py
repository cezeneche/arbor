import hashlib
import json
import os
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse
from slowapi import Limiter
from ledger_app.core.rate_limit import user_or_ip_key
from sqlalchemy import text
from ledger_app.db.session import engine
from ledger_app.services.storage import get_s3_client, S3_BUCKET
from ledger_app.services.audit_signer import sign_event
from ledger_app.services.document_validator import validate_upload, MAX_BATCH_FILES

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

    try:
        validate_upload(file.filename or "", file.content_type, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    checksum = sha256_bytes(data)
    tenant_id = (getattr(auth, "tenant_id", None) or "shared").replace("/", "_")
    safe_filename = os.path.basename(file.filename or "upload") or "upload"
    key = f"tenants/{tenant_id}/cases/{case_id}/raw/{safe_filename}"

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


def _upload_single_file(
    conn,
    s3,
    case_id: str,
    tenant_id: str,
    actor_sub: str,
    file_filename: str | None,
    file_content_type: str | None,
    data: bytes,
    doc_type: str,
) -> dict:
    """Shared upload logic used by both single and batch endpoints."""
    checksum = sha256_bytes(data)
    safe_filename = os.path.basename(file_filename or "upload") or "upload"
    safe_tenant = (tenant_id or "shared").replace("/", "_")
    key = f"tenants/{safe_tenant}/cases/{case_id}/raw/{safe_filename}"

    s3.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=data,
        ServerSideEncryption="AES256",
    )

    storage_uri = f"s3://{S3_BUCKET}/{key}"

    row = conn.execute(
        text("""
            INSERT INTO documents (case_id, filename, mime_type, storage_uri, sha256, doc_type)
            VALUES (:case_id, :filename, :mime_type, :storage_uri, :sha256, :doc_type)
            RETURNING id, case_id, filename, storage_uri, sha256, doc_type, uploaded_at
        """),
        {
            "case_id": case_id,
            "filename": file_filename,
            "mime_type": file_content_type,
            "storage_uri": storage_uri,
            "sha256": checksum,
            "doc_type": doc_type,
        },
    ).mappings().one()

    event_json = json.dumps(
        {"filename": file_filename, "doc_type": doc_type, "storage_uri": storage_uri},
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


@router.post("/cases/{case_id}/documents/upload/batch")
@_limiter.limit("2/minute")
async def batch_upload_documents(
    request: Request,
    case_id: str,
    files: list[UploadFile] = File(...),
    doc_type: str = "other",
):
    """Upload up to MAX_BATCH_FILES evidence files in one request.

    Returns 201 when all files succeed; 207 Multi-Status when any file fails.
    Per-file results are included in the response body regardless.
    """
    if len(files) > MAX_BATCH_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {MAX_BATCH_FILES} files per batch upload",
        )

    auth = getattr(request.state, "auth_context", None)
    actor_sub = auth.sub if auth else "system"
    tenant_id = (getattr(auth, "tenant_id", None) or "shared")

    results: list[dict] = []

    with engine.begin() as conn:
        _verify_case_access(conn, case_id, auth)
        s3 = get_s3_client()

        for file in files:
            fname = file.filename or "upload"
            try:
                data = await file.read()
                if not data:
                    raise ValueError("Empty file")
                validate_upload(fname, file.content_type, data)
                row = _upload_single_file(
                    conn, s3, case_id, tenant_id, actor_sub,
                    file.filename, file.content_type, data, doc_type,
                )
                results.append({"status": "ok", **row, "filename": fname})
            except (ValueError, HTTPException) as exc:
                detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
                results.append({"filename": fname, "status": "error", "detail": detail})

    succeeded = sum(1 for r in results if r["status"] == "ok")
    failed = len(results) - succeeded
    status_code = 201 if failed == 0 else 207

    return JSONResponse(
        status_code=status_code,
        content={"results": results, "succeeded": succeeded, "failed": failed},
    )
