from __future__ import annotations

from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from shared_auth import require_scopes

from . import _shared

router = APIRouter()


@router.post(
    "/cases/{case_id}/documents",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scopes(["cbam:write"]))],
)
async def create_cbam_document(request: Request, case_id: UUID, file: UploadFile = File(...)):
    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "")
    with _shared.engine.begin() as conn:
        case_columns = _shared._table_columns(conn, "cbam_cases")
        _shared._enforce_tenant_id(case_columns, tenant_id)
        _shared.set_tenant_context(conn, tenant_id)
        # Ownership check: raise 404 if case belongs to a different tenant.
        # Falls back to bare FK check (400) when tenant_id is empty (tests / legacy).
        _shared._require_case_tenant(conn, case_id, tenant_id)
        _shared._manual_fk_check(conn, "cbam_cases", case_id, "case_id")

    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File name is required.")

    document_id = str(uuid4())
    safe_filename = Path(file.filename).name
    target_dir = _shared.CBAM_STORAGE_ROOT / str(case_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    stored_path = target_dir / f"{document_id}_{safe_filename}"

    content = await file.read()
    document_sha256 = _shared.bytes_sha256_hex(content)
    stored_path.write_bytes(content)
    extraction = _shared.extract_cbam_document(str(stored_path))

    return {
        "case_id": str(case_id),
        "document_id": document_id,
        "stored_path": str(stored_path),
        "document_sha256": document_sha256,
        "extraction": extraction,
    }
