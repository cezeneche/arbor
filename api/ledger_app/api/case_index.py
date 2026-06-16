import os
import tempfile
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from ledger_app.db.session import engine
from ledger_app.services.storage import download_bytes
from ledger_app.services.llamaindex_service import index_directory, retrieve
from shared_auth import require_scopes

router = APIRouter(tags=["cases"])

# In-memory indexes per case_id (dev only)
CASE_INDEX = {}

def _key_from_storage_uri(storage_uri: str) -> str:
    # storage_uri looks like: s3://scope3-evidence/cases/<case_id>/raw/filename.ext
    parts = storage_uri.split("/", 3)
    if len(parts) < 4:
        raise ValueError(f"Invalid storage_uri: {storage_uri}")
    # parts[0]=s3:, parts[1]=, parts[2]=bucket, parts[3]=key...
    return parts[3]

@router.post("/cases/{case_id}/index", dependencies=[Depends(require_scopes(["cbam:write"]))])
def index_case(case_id: str):
    # 1) fetch documents for case
    with engine.begin() as conn:
        docs = conn.execute(
            text("""
                SELECT id, filename, storage_uri
                FROM documents
                WHERE case_id = :case_id
                ORDER BY uploaded_at ASC
            """),
            {"case_id": case_id},
        ).mappings().all()

    if not docs:
        raise HTTPException(status_code=404, detail="No documents found for this case")

    # 2) download docs to a temp folder and index
    with tempfile.TemporaryDirectory() as tmpdir:
        for d in docs:
            key = _key_from_storage_uri(d["storage_uri"])
            data = download_bytes(key)
            out_path = os.path.join(tmpdir, d["filename"])
            with open(out_path, "wb") as f:
                f.write(data)

        idx = index_directory(tmpdir)
        CASE_INDEX[case_id] = idx

    return {"indexed": True, "case_id": case_id, "document_count": len(docs)}

@router.get("/cases/{case_id}/retrieve")
def retrieve_case(case_id: str, q: str, top_k: int = 3):
    idx = CASE_INDEX.get(case_id)
    if idx is None:
        raise HTTPException(status_code=400, detail="Case not indexed yet. Call POST /api/cases/{case_id}/index first.")
    return {"case_id": case_id, "matches": retrieve(idx, q, top_k=top_k)}
