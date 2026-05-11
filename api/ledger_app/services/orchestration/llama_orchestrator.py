from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from ledger_app.services.cbam_extractor import extract as extract_cbam_document
from ledger_app.services.document_text_extractor import extract_document_from_upload


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

        pages_for_extract = pages_payload if isinstance(pages_payload, list) else None
        try:
            extraction = extract_cbam_document(str(tmp_path), layout=layout_payload, pages=pages_for_extract)
        except TypeError:
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
        if not isinstance(rule_candidate.get("evidence"), list):
            rule_candidate["evidence"] = []

        return {
            "raw_text": raw_text,
            "layout": layout_payload,
            "pages": pages_for_extract,
            "candidates": [rule_candidate],
            "routing_trace": {
                "llama_should_run": False,
                "llama_route_reasons": [],
                "llama_invoked": False,
                "llama_skipped_reason": "disabled_claude_handles_gap_fill",
                "llama_nodes_count": 0,
            },
        }
    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
