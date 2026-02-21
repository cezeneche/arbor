from fastapi import APIRouter
from app.services.llamaindex_service import index_directory, retrieve

router = APIRouter()
_index = None  # in-memory index for local testing only

@router.post("/llama-index")
def create_index():
    global _index
    _index = index_directory("test_docs")
    return {"indexed": True, "source": "test_docs"}

@router.get("/llama-retrieve")
def llama_retrieve(q: str, top_k: int = 3):
    if _index is None:
        return {"error": "Index not created yet. Call POST /api/llama-index first."}
    return {"matches": retrieve(_index, q, top_k=top_k)}
