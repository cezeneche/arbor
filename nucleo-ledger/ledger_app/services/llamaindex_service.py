from llama_index.core import VectorStoreIndex, SimpleDirectoryReader
from llama_index.core.settings import Settings
from llama_index.embeddings.fastembed import FastEmbedEmbedding

# Local embeddings (no OpenAI calls)
Settings.embed_model = FastEmbedEmbedding(model_name="BAAI/bge-small-en-v1.5")

def index_directory(path: str):
    documents = SimpleDirectoryReader(path).load_data()
    index = VectorStoreIndex.from_documents(documents)
    return index

def retrieve(index, query: str, top_k: int = 3):
    retriever = index.as_retriever(similarity_top_k=top_k)
    nodes = retriever.retrieve(query)
    return [{"score": float(n.score or 0.0), "text": n.node.get_text()} for n in nodes]
