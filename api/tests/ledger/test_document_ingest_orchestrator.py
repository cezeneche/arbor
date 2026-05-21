from __future__ import annotations

import ledger_app.services.orchestration.llama_orchestrator as ingest_orchestrator


def test_run_document_ingest_plan_returns_candidate_and_routing_trace(monkeypatch):
    monkeypatch.setattr(
        ingest_orchestrator,
        "extract_document_from_upload",
        lambda filename, content_type, data: {
            "raw_text": "Invoice Number: INV-001\nLine 1: 720711 | Coil | 10000 kg",
            "layout": {"blocks": []},
        },
    )
    monkeypatch.setattr(
        ingest_orchestrator,
        "extract_cbam_document",
        lambda _path, layout=None, pages=None: {
            "status": "parsed",
            "importer": {"name": "Alpha Steel Ltd", "eori": "GB123456789"},
            "invoice": {"invoice_number": "INV-001", "invoice_date": "2025-01-15", "origin_country": "TR"},
            "lines": [{"cn_code": "720711", "quantity": 10000, "quantity_unit": "kg", "net_mass_kg": 10000}],
            "emissions": None,
        },
    )

    plan = ingest_orchestrator.run_document_ingest_plan("invoice.txt", "text/plain", b"dummy")

    assert isinstance(plan["routing_trace"], dict)
    assert plan["routing_trace"]["llama_should_run"] is False
    assert plan["routing_trace"]["llama_invoked"] is False
    assert plan["routing_trace"]["llama_skipped_reason"] == "disabled_claude_handles_gap_fill"
    assert len(plan["candidates"]) == 1
    assert plan["candidates"][0]["source"] == "rule"


def test_run_document_ingest_plan_candidate_contains_extraction_fields(monkeypatch):
    monkeypatch.setattr(
        ingest_orchestrator,
        "extract_document_from_upload",
        lambda filename, content_type, data: {"raw_text": "Invoice Number: INV-002", "layout": None},
    )
    monkeypatch.setattr(
        ingest_orchestrator,
        "extract_cbam_document",
        lambda _path, layout=None, pages=None: {
            "status": "parsed",
            "importer": {"name": "Beta Aluminium", "eori": "DE987654321"},
            "invoice": {"invoice_number": "INV-002", "invoice_date": "2025-03-01", "origin_country": "CN"},
            "lines": [{"cn_code": "760110", "quantity": 5000, "quantity_unit": "kg", "net_mass_kg": 5000}],
            "emissions": None,
        },
    )

    plan = ingest_orchestrator.run_document_ingest_plan("invoice.txt", "text/plain", b"dummy")

    assert len(plan["candidates"]) == 1
    candidate = plan["candidates"][0]
    assert candidate["importer"]["eori"] == "DE987654321"
    assert candidate["lines"][0]["cn_code"] == "760110"
    assert isinstance(candidate["evidence"], list)
