from __future__ import annotations

from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from . import _shared

router = APIRouter()


@router.post("/cases/{case_id}/documents", status_code=status.HTTP_201_CREATED)
async def create_cbam_document(case_id: UUID, file: UploadFile = File(...)):
    with _shared.engine.begin() as conn:
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
