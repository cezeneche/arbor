import hashlib
import json
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse
from sqlalchemy import text
from ledger_app.db.session import engine
from ledger_app.services.storage import atomic_upload_document
from ledger_app.services.audit_signer import get_prev_chain_hmac, sign_event
from ledger_app.services.document_validator import validate_upload, MAX_BATCH_FILES

router = APIRouter()


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

    import uuid as _uuid
    tenant_id = (getattr(auth, "tenant_id", None) or "shared")
    document_id = str(_uuid.uuid4())
    filename = file.filename or "upload"

    async with atomic_upload_document(tenant_id, document_id, filename, data) as upload:
        with engine.begin() as conn:
            _verify_case_access(conn, case_id, auth)

            row = conn.execute(
                text("""
                    INSERT INTO documents (case_id, filename, mime_type, storage_uri, sha256, doc_type)
                    VALUES (:case_id, :filename, :mime_type, :storage_uri, :sha256, :doc_type)
                    RETURNING id, case_id, filename, storage_uri, sha256, doc_type, uploaded_at
                """),
                {
                    "case_id":     case_id,
                    "filename":    filename,
                    "mime_type":   file.content_type,
                    "storage_uri": upload.storage_uri,
                    "sha256":      upload.sha256,
                    "doc_type":    doc_type,
                },
            ).mappings().one()

            event_json = json.dumps(
                {"filename": filename, "doc_type": doc_type, "storage_uri": upload.storage_uri},
                sort_keys=True,
            )
            prev_hmac = get_prev_chain_hmac(case_id, conn)
            sig = sign_event(case_id, "doc_uploaded", actor_sub, event_json,
                             prev_hmac=prev_hmac)
            conn.execute(
                text("""
                    INSERT INTO audit_log
                        (case_id, event_type, actor_type, actor_sub, event_json,
                         hmac_sha256, prev_hmac)
                    VALUES
                        (:case_id, 'doc_uploaded', 'human', :actor_sub,
                         CAST(:event_json AS jsonb), :sig, :prev_hmac)
                """),
                {
                    "case_id":    case_id,
                    "actor_sub":  actor_sub,
                    "event_json": event_json,
                    "sig":        sig,
                    "prev_hmac":  prev_hmac,
                },
            )

    return dict(row)


async def _upload_single_file(
    conn,
    case_id: str,
    tenant_id: str,
    actor_sub: str,
    file_filename: str | None,
    file_content_type: str | None,
    data: bytes,
    doc_type: str,
) -> dict:
    """Shared upload logic used by both single and batch endpoints."""
    import uuid as _uuid
    filename = file_filename or "upload"
    document_id = str(_uuid.uuid4())

    async with atomic_upload_document(tenant_id, document_id, filename, data) as upload:
        row = conn.execute(
            text("""
                INSERT INTO documents (case_id, filename, mime_type, storage_uri, sha256, doc_type)
                VALUES (:case_id, :filename, :mime_type, :storage_uri, :sha256, :doc_type)
                RETURNING id, case_id, filename, storage_uri, sha256, doc_type, uploaded_at
            """),
            {
                "case_id":     case_id,
                "filename":    filename,
                "mime_type":   file_content_type,
                "storage_uri": upload.storage_uri,
                "sha256":      upload.sha256,
                "doc_type":    doc_type,
            },
        ).mappings().one()

        event_json = json.dumps(
            {"filename": filename, "doc_type": doc_type, "storage_uri": upload.storage_uri},
            sort_keys=True,
        )
        prev_hmac = get_prev_chain_hmac(case_id, conn)
        sig = sign_event(case_id, "doc_uploaded", actor_sub, event_json,
                         prev_hmac=prev_hmac)
        conn.execute(
            text("""
                INSERT INTO audit_log
                    (case_id, event_type, actor_type, actor_sub, event_json,
                     hmac_sha256, prev_hmac)
                VALUES
                    (:case_id, 'doc_uploaded', 'human', :actor_sub,
                     CAST(:event_json AS jsonb), :sig, :prev_hmac)
            """),
            {
                "case_id":    case_id,
                "actor_sub":  actor_sub,
                "event_json": event_json,
                "sig":        sig,
                "prev_hmac":  prev_hmac,
            },
        )

    return dict(row)


@router.post("/cases/{case_id}/documents/upload/batch")
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

        for file in files:
            fname = file.filename or "upload"
            try:
                data = await file.read()
                if not data:
                    raise ValueError("Empty file")
                validate_upload(fname, file.content_type, data)
                row = await _upload_single_file(
                    conn, case_id, tenant_id, actor_sub,
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
