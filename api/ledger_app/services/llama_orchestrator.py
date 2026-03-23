from __future__ import annotations

from typing import Any

from ledger_app.services.llama_structured_extractor import extract_structured_invoice


class LlamaOrchestrator:
    """Thin orchestration wrapper for deterministic text chunking before structured extraction."""

    def __init__(self, chunk_size: int = 512, chunk_overlap: int = 32):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def _node_text(self, node: Any) -> str:
        text = getattr(node, "text", None)
        if isinstance(text, str) and text.strip():
            return text.strip()

        get_content = getattr(node, "get_content", None)
        if callable(get_content):
            try:
                content = get_content()
            except TypeError:
                # Some node implementations accept a metadata mode.
                content = get_content(metadata_mode="none")
            if isinstance(content, str):
                return content.strip()
        return ""

    def _combine_nodes(self, nodes: list[Any], fallback_text: str) -> str:
        parts = [self._node_text(node) for node in nodes]
        combined = "\n\n".join(part for part in parts if part)
        return combined if combined else fallback_text

    def build_nodes(
        self,
        raw_text: str,
        metadata: dict[str, Any] | None = None,
        pages: list[dict[str, Any]] | None = None,
    ) -> list[Any]:
        safe_text = raw_text or ""
        safe_metadata = metadata or {}
        safe_pages = pages if isinstance(pages, list) else []

        from llama_index.core import Document
        from llama_index.core.node_parser import SentenceSplitter

        documents: list[Any] = []
        if safe_pages:
            for page in safe_pages:
                if not isinstance(page, dict):
                    continue
                page_text = str(page.get("text") or "").strip()
                if not page_text:
                    continue
                page_metadata = dict(safe_metadata)
                if page.get("page_number") is not None:
                    page_metadata["page_number"] = page.get("page_number")
                documents.append(Document(text=page_text, metadata=page_metadata))

        if not documents:
            documents = [Document(text=safe_text, metadata=safe_metadata)]

        splitter = SentenceSplitter(chunk_size=self.chunk_size, chunk_overlap=self.chunk_overlap)
        return splitter.get_nodes_from_documents(documents)

    def extract_structured(
        self,
        raw_text: str,
        metadata: dict[str, Any] | None = None,
        pages: list[dict[str, Any]] | None = None,
    ) -> tuple[Any, list[Any]]:
        safe_text = raw_text or ""

        nodes: list[Any] = []
        combined_text = safe_text

        try:
            nodes = self.build_nodes(
                raw_text=safe_text,
                metadata=metadata,
                pages=pages,
            )
            combined_text = self._combine_nodes(nodes, fallback_text=safe_text)
        except Exception:
            nodes = []
            combined_text = safe_text

        structured_output = extract_structured_invoice(combined_text)
        return structured_output, nodes
