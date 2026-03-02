from fastapi import APIRouter

router = APIRouter()
_index = None  # in-memory index for local testing only

@router.post("/llama-index")
def create_index():
    from ledger_app.services.llamaindex_service import index_directory

    global _index
    _index = index_directory("test_docs")
    return {"indexed": True, "source": "test_docs"}

@router.get("/llama-retrieve")
def llama_retrieve(q: str, top_k: int = 3):
    from ledger_app.services.llamaindex_service import retrieve

    if _index is None:
        return {"error": "Index not created yet. Call POST /api/llama-index first."}
    return {"matches": retrieve(_index, q, top_k=top_k)}
