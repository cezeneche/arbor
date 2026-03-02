from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from typing import Protocol


class CBAMExtractor(Protocol):
    def extract(self, file_path: str, layout: dict[str, Any] | None = None) -> dict:
        ...


def _parse_number(text: str | None) -> float | None:
    if text is None:
        return None
    cleaned = text.replace(",", "").strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _normalize_method(value: str | None) -> str | None:
    if not value:
        return None
    lowered = value.strip().lower().replace("_", " ").replace("-", " ")
    if "actual" in lowered:
        return "actual"
    if "estimated" in lowered or "estimate" in lowered:
        return "estimated"
    if "default" in lowered:
        return "default"
    return None


def _layout_text(layout: dict[str, Any] | None, zone: str) -> str:
    if not isinstance(layout, dict):
        return ""

    direct_value = layout.get(zone)
    if isinstance(direct_value, str):
        return direct_value.strip()
    if isinstance(direct_value, list):
        joined = " ".join(
            str(item.get("text", "")).strip() if isinstance(item, dict) else str(item).strip()
            for item in direct_value
        ).strip()
        if joined:
            return joined

    blocks = layout.get("blocks")
    if isinstance(blocks, list):
        zone_text = " ".join(
            str(block.get("text", "")).strip()
            for block in blocks
            if isinstance(block, dict) and str(block.get("type", "")).strip().lower() == zone
        ).strip()
        if zone_text:
            return zone_text

    if zone in {"full", "full_text", "raw_text"}:
        fallback = layout.get("full_text") or layout.get("raw_text")
        if isinstance(fallback, str):
            return fallback.strip()

    return ""


def _extract_lines_from_text(raw_text: str) -> list[dict[str, Any]]:
    parsed_lines: list[dict[str, Any]] = []
    line_matches = re.finditer(r"^\s*Line\s+\d+\s*:\s*(.+)$", raw_text, flags=re.IGNORECASE | re.MULTILINE)

    for match in line_matches:
        payload = match.group(1).strip()
        parts = [part.strip() for part in payload.split("|")]
        if not parts:
            continue

        cn_code = None
        cn_match = re.search(r"\b(\d{6,8})\b", parts[0])
        if cn_match:
            cn_code = cn_match.group(1)

        description = parts[1] if len(parts) > 1 else None

        quantity = None
        quantity_unit = None
        quantity_source = parts[2] if len(parts) > 2 else payload
        quantity_match = re.search(r"([0-9][0-9,]*(?:\.[0-9]+)?)\s*([A-Za-z]+)", quantity_source)
        if quantity_match:
            quantity = _parse_number(quantity_match.group(1))
            quantity_unit = quantity_match.group(2).lower()

        net_mass_kg = None
        net_mass_match = re.search(
            r"net\s*mass(?:\s*kg)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
            payload,
            flags=re.IGNORECASE,
        )
        if net_mass_match:
            net_mass_kg = _parse_number(net_mass_match.group(1))

        direct = None
        direct_match = re.search(
            r"direct(?:\s+embedded)?\s*(?:emissions?)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
            payload,
            flags=re.IGNORECASE,
        )
        if direct_match:
            direct = _parse_number(direct_match.group(1))

        indirect = None
        indirect_match = re.search(
            r"indirect(?:\s+embedded)?\s*(?:emissions?)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
            payload,
            flags=re.IGNORECASE,
        )
        if indirect_match:
            indirect = _parse_number(indirect_match.group(1))

        method = None
        method_match = re.search(
            r"method\s*([A-Za-z_ -]+)",
            payload,
            flags=re.IGNORECASE,
        )
        if method_match:
            method = _normalize_method(method_match.group(1))

        if cn_code:
            parsed_lines.append(
                {
                    "cn_code": cn_code,
                    "description": description,
                    "quantity": quantity,
                    "quantity_unit": quantity_unit,
                    "net_mass_kg": net_mass_kg if net_mass_kg is not None else quantity,
                    "direct_embedded_kgco2e": direct,
                    "indirect_embedded_kgco2e": indirect,
                    "method": method,
                }
            )

    return parsed_lines


def _extract_global_emissions_from_text(raw_text: str) -> dict[str, Any] | None:
    method_match = re.search(
        r"(?:calculation\s*method|emissions\s*method|method)\s*[:\-]\s*([A-Za-z_ -]+)",
        raw_text,
        flags=re.IGNORECASE,
    )
    direct_match = re.search(
        r"direct(?:\s+embedded)?\s+emissions?(?:\s*\(?(?:kgco2e|kg\s*co2e)\)?)?\s*[:\-]\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
        raw_text,
        flags=re.IGNORECASE,
    )
    indirect_match = re.search(
        r"indirect(?:\s+embedded)?\s+emissions?(?:\s*\(?(?:kgco2e|kg\s*co2e)\)?)?\s*[:\-]\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
        raw_text,
        flags=re.IGNORECASE,
    )

    method = _normalize_method(method_match.group(1) if method_match else None)
    direct = _parse_number(direct_match.group(1) if direct_match else None)
    indirect = _parse_number(indirect_match.group(1) if indirect_match else None)

    if method is None and direct is None and indirect is None:
        return None
    if method is None:
        return None
    return {
        "method": method,
        "direct_embedded_kgco2e": direct,
        "indirect_embedded_kgco2e": indirect,
    }


def _parse_structured_response(raw: str, raw_text: str, layout: dict[str, Any] | None = None) -> dict[str, Any]:
    fields = [
        "importer_name",
        "importer_eori",
        "invoice_number",
        "entry_reference",
        "incoterm",
        "cn_code",
        "net_mass_kg",
        "origin_country",
        "invoice_date",
        "method",
        "direct_embedded_kgco2e",
        "indirect_embedded_kgco2e",
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
    header_text = _layout_text(layout, "header")
    full_text = raw_text or _layout_text(layout, "full_text")

    # Fallback extraction from raw text when model output is not valid JSON.
    if not structured.get("importer_name"):
        match = re.search(r"importer(?:\s+name)?\s*[:\-]\s*(.+)", full_text, flags=re.IGNORECASE)
        if match:
            structured["importer_name"] = match.group(1).strip()
    if not structured.get("importer_eori"):
        match = re.search(r"\b[A-Z]{2}\d{6,}\b", full_text)
        if match:
            structured["importer_eori"] = match.group(0)
    if not structured.get("cn_code"):
        match = re.search(r"\b\d{6,8}\b", full_text)
        if match:
            structured["cn_code"] = match.group(0)
    if structured.get("net_mass_kg") is None:
        match = re.search(
            r"(?:net\s*mass(?:\s*kg)?|quantity)\D*([0-9]+(?:\.[0-9]+)?)",
            full_text,
            flags=re.IGNORECASE,
        )
        if match:
            structured["net_mass_kg"] = float(match.group(1))
    if not structured.get("origin_country"):
        match = re.search(r"origin\s*country\s*[:\-]\s*([A-Z]{2})", full_text, flags=re.IGNORECASE)
        if match:
            structured["origin_country"] = match.group(1)
    if not structured.get("invoice_number"):
        match = re.search(
            r"invoice\s*(?:number|no\.?)\s*[:\-]\s*([A-Za-z0-9\-_/]+)",
            header_text,
            flags=re.IGNORECASE,
        )
        if not match:
            match = re.search(
                r"invoice\s*(?:number|no\.?)\s*[:\-]\s*([A-Za-z0-9\-_/]+)",
                full_text,
                flags=re.IGNORECASE,
            )
        if match:
            structured["invoice_number"] = match.group(1)
    if not structured.get("entry_reference"):
        match = re.search(
            r"(?:entry\s*reference|entry\s*ref(?:erence)?)\s*[:\-]\s*([A-Za-z0-9\-_/]+)",
            full_text,
            flags=re.IGNORECASE,
        )
        if match:
            structured["entry_reference"] = match.group(1)
    if not structured.get("incoterm"):
        match = re.search(r"incoterm\s*[:\-]\s*([A-Za-z]{3})", full_text, flags=re.IGNORECASE)
        if match:
            structured["incoterm"] = match.group(1).upper()
    if not structured.get("method"):
        match = re.search(
            r"(?:calculation\s*method|emissions\s*method|method)\s*[:\-]\s*([A-Za-z_ -]+)",
            full_text,
            flags=re.IGNORECASE,
        )
        if match:
            structured["method"] = _normalize_method(match.group(1))
    else:
        structured["method"] = _normalize_method(str(structured.get("method")))
    if structured.get("direct_embedded_kgco2e") is None:
        match = re.search(
            r"direct(?:\s+embedded)?\s+emissions?(?:\s*\(?(?:kgco2e|kg\s*co2e)\)?)?\s*[:\-]\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
            full_text,
            flags=re.IGNORECASE,
        )
        if match:
            structured["direct_embedded_kgco2e"] = _parse_number(match.group(1))
    else:
        structured["direct_embedded_kgco2e"] = _parse_number(str(structured.get("direct_embedded_kgco2e")))
    if structured.get("indirect_embedded_kgco2e") is None:
        match = re.search(
            r"indirect(?:\s+embedded)?\s+emissions?(?:\s*\(?(?:kgco2e|kg\s*co2e)\)?)?\s*[:\-]\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
            full_text,
            flags=re.IGNORECASE,
        )
        if match:
            structured["indirect_embedded_kgco2e"] = _parse_number(match.group(1))
    else:
        structured["indirect_embedded_kgco2e"] = _parse_number(str(structured.get("indirect_embedded_kgco2e")))
    if not structured.get("invoice_date"):
        match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", header_text)
        if not match:
            match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", full_text)
        if match:
            structured["invoice_date"] = match.group(0)

    return structured


def _build_extraction_payload(
    raw_text: str,
    structured: dict[str, Any],
    layout: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body_text = _layout_text(layout, "body")
    extracted_lines = _extract_lines_from_text(body_text) if body_text else []
    if not extracted_lines:
        extracted_lines = _extract_lines_from_text(raw_text)
    if not extracted_lines and structured.get("cn_code"):
        extracted_lines = [
            {
                "cn_code": structured.get("cn_code"),
                "description": None,
                "quantity": structured.get("net_mass_kg"),
                "quantity_unit": "kg" if structured.get("net_mass_kg") is not None else None,
                "net_mass_kg": structured.get("net_mass_kg"),
                "direct_embedded_kgco2e": None,
                "indirect_embedded_kgco2e": None,
                "method": None,
            }
        ]

    has_line_emissions = any(
        line.get("method") is not None
        or line.get("direct_embedded_kgco2e") is not None
        or line.get("indirect_embedded_kgco2e") is not None
        for line in extracted_lines
    )

    emissions = None
    if not has_line_emissions:
        emissions = _extract_global_emissions_from_text(raw_text)
        if emissions is None:
            emissions_method = _normalize_method(structured.get("method"))
            direct = (
                _parse_number(str(structured.get("direct_embedded_kgco2e")))
                if structured.get("direct_embedded_kgco2e") is not None
                else None
            )
            indirect = (
                _parse_number(str(structured.get("indirect_embedded_kgco2e")))
                if structured.get("indirect_embedded_kgco2e") is not None
                else None
            )
            if emissions_method is not None and (direct is not None or indirect is not None):
                emissions = {
                    "method": emissions_method,
                    "direct_embedded_kgco2e": direct,
                    "indirect_embedded_kgco2e": indirect,
                }

    return {
        "status": "parsed",
        "raw_text_preview": (raw_text or "")[:500],
        "importer": {
            "name": structured.get("importer_name"),
            "eori": structured.get("importer_eori"),
        },
        "invoice": {
            "invoice_number": structured.get("invoice_number"),
            "invoice_date": structured.get("invoice_date"),
            "origin_country": structured.get("origin_country"),
            "incoterm": structured.get("incoterm"),
            "entry_reference": structured.get("entry_reference"),
        },
        "lines": extracted_lines,
        "emissions": emissions,
        "structured": structured,
    }


def _read_raw_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        try:
            return path.read_text(encoding="latin-1")
        except Exception:
            return ""


class LlamaIndexCBAMExtractor:
    def extract(self, file_path: str, layout: dict[str, Any] | None = None) -> dict:
        path = Path(file_path)
        if not path.exists():
            return {"status": "error", "message": f"File not found: {file_path}"}

        raw_text_for_fallback = _read_raw_text(path)
        try:
            from llama_index.core import SimpleDirectoryReader, VectorStoreIndex
            from llama_index.core.embeddings import MockEmbedding
            from llama_index.core.llms.mock import MockLLM
            from llama_index.core.schema import Document
        except Exception:
            structured = _parse_structured_response("{}", raw_text_for_fallback, layout=layout)
            payload = _build_extraction_payload(raw_text_for_fallback, structured, layout=layout)
            payload["status"] = "parsed"
            payload["fallback"] = "regex_only"
            return payload

        try:
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
                "importer_name, importer_eori, invoice_number, entry_reference, incoterm, "
                "cn_code, net_mass_kg, origin_country, invoice_date, method, "
                "direct_embedded_kgco2e, indirect_embedded_kgco2e. "
                "Use method values actual/default/estimated and null for missing values."
            )
            structured = _parse_structured_response(str(response), raw_text, layout=layout)
            return _build_extraction_payload(raw_text, structured, layout=layout)
        except Exception as e:
            return {"status": "error", "message": str(e)}


_EXTRACTOR: CBAMExtractor = LlamaIndexCBAMExtractor()


def extract(file_path: str, layout: dict[str, Any] | None = None) -> dict:
    try:
        return _EXTRACTOR.extract(file_path, layout=layout)
    except TypeError:
        return _EXTRACTOR.extract(file_path)
