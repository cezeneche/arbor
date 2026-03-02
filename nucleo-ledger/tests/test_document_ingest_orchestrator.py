from __future__ import annotations

import app.services.orchestration.llama_orchestrator as ingest_orchestrator
from app.services.llama_structured_extractor import InvoiceSchema
from app.services.llama_structured_extractor import LineItemSchema


def test_run_document_ingest_plan_skips_llama_without_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    monkeypatch.setattr(
        ingest_orchestrator,
        "extract_document_from_upload",
        lambda filename, content_type, data: {
            "raw_text": "Invoice Number: INV-MISS-001\nInvoice Date: 2025-01-15\nLine 1: 720711 | Coil | 10000 kg",
            "layout": {"blocks": [{"type": "header", "text": "Invoice Date: 2025-01-15", "lines_idx": [0]}]},
        },
    )
    monkeypatch.setattr(
        ingest_orchestrator,
        "extract_cbam_document",
        lambda _path, layout=None: {
            "status": "parsed",
            "importer": {"name": "Alpha", "eori": "GB123456789"},
            "invoice": {"invoice_number": None, "invoice_date": None, "origin_country": "TR"},
            "lines": [{"cn_code": "720711", "quantity": 10000, "quantity_unit": "kg", "net_mass_kg": 10000}],
            "emissions": None,
        },
    )

    class _ShouldNotRun:
        def extract_structured(self, raw_text, metadata=None, pages=None):
            raise AssertionError("Llama should not be invoked without API key")

    monkeypatch.setattr(ingest_orchestrator, "LlamaOrchestrator", lambda: _ShouldNotRun())

    plan = ingest_orchestrator.run_document_ingest_plan("invoice.txt", "text/plain", b"dummy")

    assert isinstance(plan["routing_trace"], dict)
    assert plan["routing_trace"]["llama_should_run"] is True
    assert plan["routing_trace"]["llama_invoked"] is False
    assert plan["routing_trace"]["llama_skipped_reason"] == "missing_openai_api_key"
    assert len(plan["candidates"]) == 1


def test_run_document_ingest_plan_invokes_llama_when_rule_missing_header_fields(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    monkeypatch.setattr(
        ingest_orchestrator,
        "extract_document_from_upload",
        lambda filename, content_type, data: {
            "raw_text": "Invoice Number: INV-LLAMA-001\nInvoice Date: 2025-01-15\nLine 1: 720711 | Coil | 10000 kg",
            "layout": {"blocks": [{"type": "header", "text": "Invoice Number: INV-LLAMA-001", "lines_idx": [0]}]},
        },
    )
    monkeypatch.setattr(
        ingest_orchestrator,
        "extract_cbam_document",
        lambda _path, layout=None: {
            "status": "parsed",
            "importer": {"name": "Alpha", "eori": "GB123456789"},
            "invoice": {"invoice_number": None, "invoice_date": None, "origin_country": "TR"},
            "lines": [{"cn_code": "720711", "quantity": 10000, "quantity_unit": "kg", "net_mass_kg": 10000}],
            "emissions": None,
        },
    )

    class _StubOrchestrator:
        def extract_structured(self, raw_text, metadata=None, pages=None):
            return (
                InvoiceSchema(
                    importer_name="Alpha",
                    invoice_number="INV-LLAMA-001",
                    invoice_date="2025-01-15",
                    origin_country="TR",
                    line_items=[LineItemSchema(cn_code="720711", description="Coil", quantity=10000)],
                ),
                ["node-1", "node-2"],
            )

    monkeypatch.setattr(ingest_orchestrator, "LlamaOrchestrator", lambda: _StubOrchestrator())

    plan = ingest_orchestrator.run_document_ingest_plan("invoice.txt", "text/plain", b"dummy")

    assert isinstance(plan["routing_trace"], dict)
    assert plan["routing_trace"]["llama_should_run"] is True
    assert plan["routing_trace"]["llama_invoked"] is True
    assert plan["routing_trace"]["llama_nodes_count"] == 2
    assert plan["routing_trace"].get("llama_output", {}).get("invoice_number") == "INV-LLAMA-001"
    assert "missing_invoice_number" in plan["routing_trace"]["llama_route_reasons"]
    assert "missing_invoice_date" in plan["routing_trace"]["llama_route_reasons"]
    assert len(plan["candidates"]) == 2
