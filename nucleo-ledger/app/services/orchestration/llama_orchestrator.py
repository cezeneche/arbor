from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.services.cbam_extractor import extract as extract_cbam_document
from app.services.document_text_extractor import extract_document_from_upload
from app.services.llama_orchestrator import LlamaOrchestrator


def _layout_zone_text(layout: dict[str, Any] | None, zone: str) -> str:
    if not isinstance(layout, dict):
        return ""

    direct = layout.get(zone)
    if isinstance(direct, str):
        return direct.strip()

    blocks = layout.get("blocks")
    if isinstance(blocks, list):
        return "\n".join(
            str(block.get("text", "")).strip()
            for block in blocks
            if isinstance(block, dict) and str(block.get("type", "")).strip().lower() == zone
        ).strip()

    return ""


def _header_invoice_number(header_text: str) -> str | None:
    if not header_text:
        return None
    match = re.search(
        r"invoice\s*(?:number|no\.?|#)\s*[:\-]\s*([A-Za-z0-9\-_/]+)",
        header_text,
        flags=re.IGNORECASE,
    )
    return match.group(1) if match else None


def _header_invoice_date(header_text: str) -> str | None:
    if not header_text:
        return None
    match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", header_text)
    return match.group(0) if match else None


def _rule_value(candidate: dict[str, Any], key: str) -> Any:
    invoice = candidate.get("invoice")
    if isinstance(invoice, dict):
        return invoice.get(key)
    return None


def _line_items_empty(candidate: dict[str, Any]) -> bool:
    lines = candidate.get("lines")
    return not (isinstance(lines, list) and len(lines) > 0)


def _line_items_incomplete(candidate: dict[str, Any]) -> bool:
    lines = candidate.get("lines")
    if not isinstance(lines, list):
        return False
    for line in lines:
        if not isinstance(line, dict):
            continue
        if not line.get("cn_code"):
            return True
        if line.get("quantity") is None and line.get("net_mass_kg") is None:
            return True
    return False


def _conflicts_likely(rule_candidate: dict[str, Any], layout: dict[str, Any] | None) -> bool:
    header_text = _layout_zone_text(layout, "header")
    if not header_text:
        return False

    header_invoice = _header_invoice_number(header_text)
    header_date = _header_invoice_date(header_text)
    rule_invoice = _rule_value(rule_candidate, "invoice_number")
    rule_date = _rule_value(rule_candidate, "invoice_date")

    if header_invoice and rule_invoice and str(header_invoice).strip() != str(rule_invoice).strip():
        return True
    if header_date and rule_date and str(header_date).strip() != str(rule_date).strip():
        return True
    return False


def _should_run_llama(rule_candidate: dict[str, Any], layout: dict[str, Any] | None) -> tuple[bool, list[str]]:
    reasons: list[str] = []

    if not _rule_value(rule_candidate, "invoice_number"):
        reasons.append("missing_invoice_number")
    if not _rule_value(rule_candidate, "invoice_date"):
        reasons.append("missing_invoice_date")
    if _line_items_empty(rule_candidate):
        reasons.append("line_items_empty")
    if _line_items_incomplete(rule_candidate):
        reasons.append("line_items_incomplete")
    if _conflicts_likely(rule_candidate, layout):
        reasons.append("conflicts_likely")

    return len(reasons) > 0, reasons


def _llama_candidate_from_structured(
    rule_candidate: dict[str, Any],
    llama_output: Any,
    raw_text: str,
    layout_payload: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if llama_output is None:
        return None

    if hasattr(llama_output, "model_dump"):
        llama_data = llama_output.model_dump()
    elif isinstance(llama_output, dict):
        llama_data = llama_output
    else:
        return None

    if not isinstance(llama_data, dict):
        return None

    normalized_lines: list[dict[str, Any]] = []
    line_items = llama_data.get("line_items")
    if isinstance(line_items, list):
        for item in line_items:
            if not isinstance(item, dict):
                continue
            quantity = item.get("quantity")
            normalized_lines.append(
                {
                    "cn_code": item.get("cn_code"),
                    "description": item.get("description"),
                    "quantity": quantity,
                    "quantity_unit": "kg" if quantity is not None else None,
                    "net_mass_kg": quantity,
                }
            )

    has_signal = any(
        llama_data.get(field)
        for field in ("importer_name", "invoice_number", "invoice_date", "origin_country")
    ) or bool(normalized_lines)
    if not has_signal:
        return None

    base_importer = rule_candidate.get("importer")
    base_invoice = rule_candidate.get("invoice")
    base_importer_eori = base_importer.get("eori") if isinstance(base_importer, dict) else None
    base_incoterm = base_invoice.get("incoterm") if isinstance(base_invoice, dict) else None
    base_entry_reference = base_invoice.get("entry_reference") if isinstance(base_invoice, dict) else None

    return {
        "source": "llama",
        "importer": {
            "name": llama_data.get("importer_name"),
            "eori": base_importer_eori,
        },
        "invoice": {
            "invoice_number": llama_data.get("invoice_number"),
            "invoice_date": llama_data.get("invoice_date"),
            "origin_country": llama_data.get("origin_country"),
            "incoterm": base_incoterm,
            "entry_reference": base_entry_reference,
        },
        "lines": normalized_lines,
        "emissions": rule_candidate.get("emissions"),
        "structured": rule_candidate.get("structured"),
        "layout": layout_payload,
        "full_text": raw_text,
    }


def run_document_ingest_plan(filename: str, content_type: str | None, data: bytes) -> dict[str, Any]:
    extracted_document = extract_document_from_upload(
        filename=filename,
        content_type=content_type,
        data=data,
    )
    raw_text = str(extracted_document.get("raw_text", ""))
    layout = extracted_document.get("layout")
    layout_payload = layout if isinstance(layout, dict) else None
    pages_payload = extracted_document.get("pages")

    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix="cbam_invoice_", suffix=".txt", delete=False) as tmp:
            tmp_path = Path(tmp.name)
            tmp.write(raw_text.encode("utf-8"))

        try:
            extraction = extract_cbam_document(str(tmp_path), layout=layout_payload)
        except TypeError:
            extraction = extract_cbam_document(str(tmp_path))

        if not isinstance(extraction, dict):
            raise HTTPException(status_code=422, detail="Extractor returned an invalid response.")

        extraction_status = extraction.get("status")
        if extraction_status in {"error", "llamaindex_not_available", "not_implemented"}:
            detail_message = extraction.get("message") or f"Extraction status: {extraction_status}"
            raise HTTPException(status_code=422, detail=str(detail_message))

        rule_candidate = dict(extraction)
        rule_candidate["source"] = "rule"
        rule_candidate["layout"] = layout_payload
        rule_candidate["full_text"] = raw_text

        candidates: list[dict[str, Any]] = [rule_candidate]
        should_run, route_reasons = _should_run_llama(rule_candidate, layout_payload)
        routing_trace: dict[str, Any] = {
            "llama_should_run": should_run,
            "llama_route_reasons": route_reasons,
            "llama_invoked": False,
            "llama_skipped_reason": None,
            "llama_nodes_count": 0,
        }

        if should_run:
            if not os.getenv("OPENAI_API_KEY"):
                routing_trace["llama_skipped_reason"] = "missing_openai_api_key"
            else:
                llama_output, llama_nodes = LlamaOrchestrator().extract_structured(
                    raw_text,
                    metadata={"filename": filename, "content_type": content_type},
                    pages=pages_payload if isinstance(pages_payload, list) else None,
                )
                routing_trace["llama_invoked"] = True
                routing_trace["llama_nodes_count"] = len(llama_nodes)
                if hasattr(llama_output, "model_dump"):
                    routing_trace["llama_output"] = llama_output.model_dump()
                elif isinstance(llama_output, dict):
                    routing_trace["llama_output"] = llama_output
                else:
                    routing_trace["llama_output"] = None

                llama_candidate = _llama_candidate_from_structured(
                    rule_candidate=rule_candidate,
                    llama_output=llama_output,
                    raw_text=raw_text,
                    layout_payload=layout_payload,
                )
                if llama_candidate is not None:
                    candidates.append(llama_candidate)
        else:
            routing_trace["llama_skipped_reason"] = "rule_candidate_sufficient"

        return {
            "raw_text": raw_text,
            "layout": layout_payload,
            "candidates": candidates,
            "routing_trace": routing_trace,
        }
    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
