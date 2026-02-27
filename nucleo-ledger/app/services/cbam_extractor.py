from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from typing import Protocol


class CBAMExtractor(Protocol):
    def extract(self, file_path: str) -> dict:
        ...


def _parse_structured_response(raw: str, raw_text: str) -> dict[str, Any]:
    fields = [
        "importer_name",
        "importer_eori",
        "cn_code",
        "net_mass_kg",
        "origin_country",
        "invoice_date",
    ]
    parsed: dict[str, Any] = {}

    try:
        loaded = json.loads(raw)
        if isinstance(loaded, dict):
            parsed = loaded
    except Exception:
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                loaded = json.loads(raw[start : end + 1])
                if isinstance(loaded, dict):
                    parsed = loaded
            except Exception:
                parsed = {}

    structured = {key: parsed.get(key) for key in fields}

    # Fallback extraction from raw text when model output is not valid JSON.
    if not structured.get("importer_name"):
        match = re.search(r"importer(?:\s+name)?\s*[:\-]\s*(.+)", raw_text, flags=re.IGNORECASE)
        if match:
            structured["importer_name"] = match.group(1).strip()
    if not structured.get("importer_eori"):
        match = re.search(r"\b[A-Z]{2}\d{6,}\b", raw_text)
        if match:
            structured["importer_eori"] = match.group(0)
    if not structured.get("cn_code"):
        match = re.search(r"\b\d{6,8}\b", raw_text)
        if match:
            structured["cn_code"] = match.group(0)
    if structured.get("net_mass_kg") is None:
        match = re.search(
            r"(?:net\s*mass(?:\s*kg)?|quantity)\D*([0-9]+(?:\.[0-9]+)?)",
            raw_text,
            flags=re.IGNORECASE,
        )
        if match:
            structured["net_mass_kg"] = float(match.group(1))
    if not structured.get("origin_country"):
        match = re.search(r"origin\s*country\s*[:\-]\s*([A-Z]{2})", raw_text, flags=re.IGNORECASE)
        if match:
            structured["origin_country"] = match.group(1)
    if not structured.get("invoice_date"):
        match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", raw_text)
        if match:
            structured["invoice_date"] = match.group(0)

    return structured


def _read_raw_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        try:
            return path.read_text(encoding="latin-1")
        except Exception:
            return ""


class LlamaIndexCBAMExtractor:
    def extract(self, file_path: str) -> dict:
        try:
            from llama_index.core import SimpleDirectoryReader, VectorStoreIndex
            from llama_index.core.embeddings import MockEmbedding
            from llama_index.core.llms.mock import MockLLM
            from llama_index.core.schema import Document
        except Exception:
            return {"status": "llamaindex_not_available"}

        try:
            path = Path(file_path)
            if not path.exists():
                raise FileNotFoundError(f"File not found: {file_path}")

            documents = SimpleDirectoryReader(input_files=[str(path)]).load_data()

            raw_text = "\n\n".join(
                (getattr(doc, "text", "") or "").strip() for doc in documents
            ).strip()

            if not raw_text:
                raw_text = _read_raw_text(path)

            if not documents:
                documents = [Document(text=raw_text)]

            index = VectorStoreIndex.from_documents(
                documents,
                embed_model=MockEmbedding(embed_dim=32),
            )
            query_engine = index.as_query_engine(llm=MockLLM())
            response = query_engine.query(
                "Extract and return ONLY a JSON object with keys: "
                "importer_name, importer_eori, cn_code, net_mass_kg, "
                "origin_country, invoice_date. Use null for missing values."
            )
            structured = _parse_structured_response(str(response), raw_text)

            return {
                "status": "parsed",
                "raw_text_preview": (raw_text or "")[:500],
                "structured": structured,
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}


_EXTRACTOR: CBAMExtractor = LlamaIndexCBAMExtractor()


def extract(file_path: str) -> dict:
    return _EXTRACTOR.extract(file_path)
