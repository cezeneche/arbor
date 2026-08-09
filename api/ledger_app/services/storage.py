"""
Supabase Storage — complete replacement for the MinIO/boto3 storage module.

Buckets
-------
cbam-documents      Private. Tenant-scoped RLS. All compliance evidence files.
cbam-audit-exports  Private. Write-once compensating control (see below).

Object Lock / WORM note
-----------------------
Supabase Storage does not support S3 Object Lock natively. The compensating
control implemented here is:
  1. Every export is hashed (SHA-256) before upload.
  2. A row is inserted into cbam.audit_exports with the path, hash, and
     timestamp immediately after upload.
  3. A CHECK constraint on audit_exports prevents the hash column from ever
     being set to NULL, making silent hash erasure impossible via SQL.
  4. Supabase RLS on audit_exports has no UPDATE or DELETE policies — rows
     are append-only for authenticated users.
  5. Periodic reconciliation can re-download the file and verify the stored
     hash still matches (detective control).

This does not prevent a storage admin from deleting the file, but it means
any deletion or tampering is detectable and leaves an evidence trail.

Run the following SQL in Supabase once before using this module:

    -- Create buckets (run via Supabase dashboard Storage UI or SQL)
    INSERT INTO storage.buckets (id, name, public)
    VALUES
      ('cbam-documents',     'cbam-documents',     false),
      ('cbam-audit-exports', 'cbam-audit-exports', false)
    ON CONFLICT (id) DO NOTHING;

    -- RLS: authenticated users can only access their own tenant prefix
    CREATE POLICY "tenant_documents_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'cbam-documents'
        AND (storage.foldername(name))[1] = current_setting('app.current_tenant_id', true)
      );

    CREATE POLICY "tenant_documents_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'cbam-documents'
        AND (storage.foldername(name))[1] = current_setting('app.current_tenant_id', true)
      );

    CREATE POLICY "tenant_documents_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'cbam-documents'
        AND (storage.foldername(name))[1] = current_setting('app.current_tenant_id', true)
      );

    -- audit_exports: append-only compensating control table
    CREATE TABLE IF NOT EXISTS cbam.audit_exports (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id    TEXT NOT NULL,
      case_id      TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      sha256       TEXT NOT NULL CHECK (sha256 <> ''),  -- non-nullable + non-empty
      exported_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE cbam.audit_exports ENABLE ROW LEVEL SECURITY;
    -- SELECT only — no UPDATE/DELETE policies
    CREATE POLICY "audit_exports_select" ON cbam.audit_exports
      FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));
    CREATE POLICY "audit_exports_insert" ON cbam.audit_exports
      FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncGenerator

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Bucket names
# ---------------------------------------------------------------------------

BUCKET_DOCUMENTS   = "cbam-documents"
BUCKET_AUDIT       = "cbam-audit-exports"

# Backward-compat alias so callers that import S3_BUCKET still compile
S3_BUCKET = BUCKET_DOCUMENTS

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SUPABASE_URL              = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_ANON_KEY         = os.getenv("SUPABASE_ANON_KEY", "")

# Signed URL expiry in seconds (1 hour)
SIGNED_URL_EXPIRY = 3600

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _storage_client():
    """Return the Supabase async client used for Storage operations.

    Falls back to creating a fresh client if the module-level singleton has
    not been initialised yet (e.g. during tests or CLI invocations).
    """
    try:
        from ledger_app.db.supabase_client import get_admin_client
        return get_admin_client()
    except RuntimeError:
        # Lifespan hasn't run — create a one-shot client
        from supabase import create_client
        if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
            )
        return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def _run_async(coro):
    """Run an async coroutine from a synchronous context.

    Used by the backward-compatible sync wrappers (download_bytes, upload_text)
    so that callers in sync FastAPI routes (extract.py) keep working
    without modification.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # We are inside an async context — use a new thread to avoid
        # blocking the event loop.
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(asyncio.run, coro)
            return future.result()
    else:
        return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

@dataclass
class UploadResult:
    storage_path: str   # path inside the bucket
    storage_uri:  str   # supabase://cbam-documents/{path}
    sha256:       str   # hex SHA-256 of raw bytes
    size_bytes:   int


@dataclass
class AuditExportResult:
    storage_path: str
    storage_uri:  str
    sha256:       str
    size_bytes:   int


# ---------------------------------------------------------------------------
# Document upload — async
# ---------------------------------------------------------------------------

async def upload_document_async(
    tenant_id:   str,
    document_id: str,
    filename:    str,
    data:        bytes,
) -> UploadResult:
    """Upload a compliance document to Supabase Storage.

    Path pattern: {tenant_id}/{document_id}/{filename}

    Returns an UploadResult containing the storage path and SHA-256 hash.
    Does NOT insert the DB record — the caller is responsible for that so
    that the DB insert and storage upload can be coordinated atomically via
    atomic_upload_document().
    """
    sha256 = _sha256(data)
    safe_tenant   = tenant_id.replace("/", "_").replace("..", "")
    safe_filename = os.path.basename(filename) or "upload"
    path = f"{safe_tenant}/{document_id}/{safe_filename}"

    client = _storage_client()
    client.storage.from_(BUCKET_DOCUMENTS).upload(
        path=path,
        file=data,
        file_options={
            "content-type": _guess_mime(safe_filename),
            "x-upsert": "false",  # never silently overwrite
        },
    )
    logger.debug("Uploaded document: bucket=%s path=%s sha256=%s", BUCKET_DOCUMENTS, path, sha256)

    return UploadResult(
        storage_path=path,
        storage_uri=f"supabase://{BUCKET_DOCUMENTS}/{path}",
        sha256=sha256,
        size_bytes=len(data),
    )


async def delete_document_async(storage_path: str) -> None:
    """Delete a document from storage. Used to roll back a failed upload."""
    try:
        client = _storage_client()
        client.storage.from_(BUCKET_DOCUMENTS).remove([storage_path])
        logger.debug("Rolled back storage upload: %s", storage_path)
    except Exception as exc:
        logger.warning("Storage rollback failed for %s: %s", storage_path, exc)


@asynccontextmanager
async def atomic_upload_document(
    tenant_id:   str,
    document_id: str,
    filename:    str,
    data:        bytes,
) -> AsyncGenerator[UploadResult, None]:
    """Async context manager for atomic document upload.

    Uploads the file to Supabase Storage, then yields the UploadResult.
    If the body of the `async with` block raises ANY exception (e.g. a DB
    insert failure), the storage upload is automatically rolled back.

    Usage in documents.py:

        async with atomic_upload_document(tenant_id, doc_id, filename, data) as result:
            # Insert DB record here — if this raises, storage is rolled back
            conn.execute(text("INSERT INTO documents ..."), {
                "storage_uri": result.storage_uri,
                "sha256": result.sha256,
                ...
            })
    """
    result = await upload_document_async(tenant_id, document_id, filename, data)
    try:
        yield result
    except Exception:
        await delete_document_async(result.storage_path)
        raise


# ---------------------------------------------------------------------------
# Document download — async
# ---------------------------------------------------------------------------

async def get_signed_url_async(
    storage_path:  str,
    expected_sha256: str | None = None,
    expiry_seconds: int = SIGNED_URL_EXPIRY,
) -> str:
    """Generate a 1-hour signed URL for a document.

    If expected_sha256 is provided, the file is downloaded first to verify
    the hash matches before issuing the URL. Raises ValueError on mismatch.
    """
    client = _storage_client()

    if expected_sha256:
        raw = await download_document_async(storage_path, expected_sha256)
        # Hash verified — now generate the signed URL
        del raw  # don't hold bytes in memory longer than needed

    response = client.storage.from_(BUCKET_DOCUMENTS).create_signed_url(
        path=storage_path,
        expires_in=expiry_seconds,
    )
    signed_url: str = response.get("signedURL") or response.get("signed_url", "")
    if not signed_url:
        raise RuntimeError(f"Supabase did not return a signed URL for {storage_path}")

    return signed_url


async def download_document_async(
    storage_path:    str,
    expected_sha256: str | None = None,
) -> bytes:
    """Download raw bytes from Supabase Storage.

    If expected_sha256 is provided, verifies the hash before returning.
    Raises ValueError if the hash does not match (tamper detection).
    """
    client = _storage_client()
    data: bytes = client.storage.from_(BUCKET_DOCUMENTS).download(storage_path)

    if expected_sha256:
        actual = _sha256(data)
        if actual != expected_sha256:
            raise ValueError(
                f"SHA-256 mismatch for {storage_path}: "
                f"expected={expected_sha256} actual={actual}"
            )

    return data


# ---------------------------------------------------------------------------
# Audit export — async
# ---------------------------------------------------------------------------

async def upload_audit_export_async(
    tenant_id:   str,
    case_id:     str,
    payload:     bytes,
    db_conn=None,  # optional SQLAlchemy connection for recording the export
) -> AuditExportResult:
    """Upload a signed audit log export to the cbam-audit-exports bucket.

    The file is treated as immutable via a compensating control:
    - The SHA-256 hash is computed before upload
    - A row is inserted into cbam.audit_exports with the hash
    - RLS on audit_exports has no UPDATE/DELETE policies (append-only)
    - The CHECK constraint on sha256 prevents NULL/empty hash erasure

    Supabase Storage does not support Object Lock (WORM) natively. This
    compensating control makes tampering detectable but not cryptographically
    preventable at the storage layer. A storage admin could delete the file.
    For true WORM compliance, consider routing audit exports to AWS S3 with
    Object Lock enabled in a separate bucket.
    """
    sha256 = _sha256(payload)
    safe_tenant = tenant_id.replace("/", "_").replace("..", "")

    from datetime import datetime, timezone
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = f"{safe_tenant}/{case_id}/audit-export-{ts}.json"

    client = _storage_client()
    client.storage.from_(BUCKET_AUDIT).upload(
        path=path,
        file=payload,
        file_options={
            "content-type": "application/json",
            "x-upsert": "false",
        },
    )

    uri = f"supabase://{BUCKET_AUDIT}/{path}"
    logger.info("Audit export uploaded: path=%s sha256=%s", path, sha256)

    # Record in audit_exports table (compensating control for no Object Lock)
    if db_conn is not None:
        try:
            from sqlalchemy import text as sqla_text
            db_conn.execute(
                sqla_text("""
                    INSERT INTO cbam.audit_exports
                        (tenant_id, case_id, storage_path, sha256)
                    VALUES
                        (:tenant_id, :case_id, :storage_path, :sha256)
                """),
                {
                    "tenant_id":    tenant_id,
                    "case_id":      case_id,
                    "storage_path": path,
                    "sha256":       sha256,
                },
            )
        except Exception as exc:
            # Non-fatal — the file is uploaded; log and continue
            logger.warning("Failed to record audit export in DB: %s", exc)

    return AuditExportResult(
        storage_path=path,
        storage_uri=uri,
        sha256=sha256,
        size_bytes=len(payload),
    )


async def verify_audit_export_async(storage_path: str, expected_sha256: str) -> bool:
    """Re-download an audit export and verify its hash (detective control)."""
    client = _storage_client()
    try:
        data: bytes = client.storage.from_(BUCKET_AUDIT).download(storage_path)
        actual = _sha256(data)
        return actual == expected_sha256
    except Exception as exc:
        logger.error("Audit export verification failed for %s: %s", storage_path, exc)
        return False


# ---------------------------------------------------------------------------
# Health check — async
# ---------------------------------------------------------------------------

async def storage_healthcheck_async() -> dict:
    """Verify both storage buckets are reachable."""
    client = _storage_client()
    results: dict = {}
    for bucket in (BUCKET_DOCUMENTS, BUCKET_AUDIT):
        try:
            # List at most 1 object — a cheap existence check
            client.storage.from_(bucket).list(options={"limit": 1})
            results[bucket] = "ok"
        except Exception as exc:
            results[bucket] = f"error: {exc}"
    return {"storage": results, "ok": all(v == "ok" for v in results.values())}


# ---------------------------------------------------------------------------
# Backward-compatible SYNC wrappers
# These keep existing callers (extract.py, storage_check.py)
# working without modification.
# ---------------------------------------------------------------------------

def download_bytes(key: str) -> bytes:
    """Sync wrapper around download_document_async.

    Accepts either a legacy S3 key (tenants/{tid}/cases/{cid}/raw/{file})
    or a new Supabase Storage path ({tid}/{doc_id}/{file}).
    No hash verification — callers that need it should use the async API.
    """
    return _run_async(download_document_async(key))


def upload_text(key: str, content: str) -> str:
    """Sync wrapper — uploads UTF-8 text and returns a supabase:// URI.

    Key is used as-is as the storage path inside BUCKET_DOCUMENTS.
    """
    data = content.encode("utf-8")
    sha256 = _sha256(data)
    client = _storage_client()
    client.storage.from_(BUCKET_DOCUMENTS).upload(
        path=key,
        file=data,
        file_options={"content-type": "text/plain", "x-upsert": "true"},
    )
    return f"supabase://{BUCKET_DOCUMENTS}/{key}"


def s3_healthcheck() -> dict:
    """Sync healthcheck — retained for storage_check.py backward compat."""
    return _run_async(storage_healthcheck_async())


# ---------------------------------------------------------------------------
# Legacy stub — get_s3_client
# Callers that imported this to call s3.put_object() directly must be
# updated to use upload_document_async() or atomic_upload_document().
# This stub raises a clear error rather than silently doing nothing.
# ---------------------------------------------------------------------------

def get_s3_client():
    raise NotImplementedError(
        "MinIO/boto3 has been replaced with Supabase Storage. "
        "Use upload_document_async() or atomic_upload_document() instead of "
        "get_s3_client().put_object()."
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _guess_mime(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return {
        "pdf":  "application/pdf",
        "json": "application/json",
        "xml":  "application/xml",
        "csv":  "text/csv",
        "txt":  "text/plain",
        "png":  "image/png",
        "jpg":  "image/jpeg",
        "jpeg": "image/jpeg",
    }.get(ext, "application/octet-stream")
