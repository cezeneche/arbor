from __future__ import annotations

from llama_index.core import SimpleDirectoryReader, VectorStoreIndex


def _init_embed_model() -> None:
    from llama_index.core.settings import Settings
    from llama_index.embeddings.fastembed import FastEmbedEmbedding

    if getattr(Settings, "embed_model", None) is None:
        Settings.embed_model = FastEmbedEmbedding(model_name="BAAI/bge-small-en-v1.5")


def index_directory(path: str) -> VectorStoreIndex:
    _init_embed_model()
    documents = SimpleDirectoryReader(path).load_data()
    return VectorStoreIndex.from_documents(documents)


def retrieve(index: VectorStoreIndex, query: str, top_k: int = 3) -> list[dict]:
    retriever = index.as_retriever(similarity_top_k=top_k)
    nodes = retriever.retrieve(query)
    return [{"score": float(n.score or 0.0), "text": n.node.get_text()} for n in nodes]
