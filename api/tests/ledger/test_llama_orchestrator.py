from __future__ import annotations

from pathlib import Path

import ledger_app.api.cbam as cbam_api
import ledger_app.services.llama_orchestrator as llama_orchestrator
from ledger_app.services.llama_structured_extractor import InvoiceSchema
from ledger_app.services.llama_structured_extractor import LineItemSchema
from ledger_app.testing import _client_with_fake_engine


def test_llama_orchestrator_creates_nodes_and_returns_structured_output(monkeypatch):
    captured: dict[str, str] = {}

    def _stub_extract_structured_invoice(text: str) -> InvoiceSchema:
        captured["text"] = text
        return InvoiceSchema(
            importer_name="Alpha Steel Ltd",
            invoice_number="INV-ORCH-001",
            invoice_date="2025-01-15",
            line_items=[LineItemSchema(cn_code="720711", quantity=10000)],
        )

    monkeypatch.setattr(llama_orchestrator, "extract_structured_invoice", _stub_extract_structured_invoice)

    orchestrator = llama_orchestrator.LlamaOrchestrator(chunk_size=40, chunk_overlap=0)
    structured, nodes = orchestrator.extract_structured(
        "Invoice Number: INV-ORCH-001\nInvoice Date: 2025-01-15\nLine 1: 720711 | Coil | 10000 kg",
        metadata={"source": "unit-test"},
    )

    assert len(nodes) >= 1
    assert structured.invoice_number == "INV-ORCH-001"
    assert "INV-ORCH-001" in captured["text"]


def test_llama_orchestrator_no_regression_in_from_document_flow(monkeypatch):
    """The from-document endpoint now returns a stub immediately; the pipeline runs
    as a background task.  Verify that a goods line is created for the CN code
    returned by the orchestrator, proving the orchestrator output is consumed."""
    client, conn = _client_with_fake_engine()
    fixture_path = (
        Path(__file__).resolve().parents[3]
        / "fixtures"
        / "documents"
        / "sample_invoice_TEST.txt"
    )

    class _FakeOrchestrator:
        def __setattr__(self, name: str, value: object) -> None:
            object.__setattr__(self, name, value)

        def run_document_ingest_plan(self, **_kwargs: object) -> dict:
            return {
                "raw_text": "Invoice Number: INV-ORCH-FLOW-1\nCN code: 720711\n",
                "layout": None,
                "routing_trace": {},
                "candidates": [{
                    "status": "parsed",
                    "importer": {"name": "Alpha Steel Ltd", "eori": "GB123456789"},
                    "invoice": {
                        "invoice_number": "INV-ORCH-FLOW-1",
                        "invoice_date": "2025-01-15",
                        "origin_country": "TR",
                    },
                    "lines": [{
                        "cn_code": "720711",
                        "description": "Hot rolled steel coil",
                        "quantity": 10000,
                        "quantity_unit": "kg",
                        "net_mass_kg": 10000,
                    }],
                    "emissions": None,
                    "evidence": [],
                }],
            }

    monkeypatch.setattr(cbam_api, "ingest_orchestrator", _FakeOrchestrator())

    response = client.post(
        "/api/cbam/drafts/from-document",
        files={"file": (fixture_path.name, fixture_path.read_bytes(), "text/plain")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["created"]["case_id"] is not None
    assert body["document_sha256"] is not None
    assert len(conn.goods_lines) == 1
    gl = next(iter(conn.goods_lines.values()))
    assert gl["cn_code"] == "720711"


def test_llama_orchestrator_build_nodes_preserves_page_number_metadata(monkeypatch):
    monkeypatch.setattr(
        llama_orchestrator,
        "extract_structured_invoice",
        lambda _text: InvoiceSchema(invoice_number="INV-PAGES-001", line_items=[]),
    )

    orchestrator = llama_orchestrator.LlamaOrchestrator(chunk_size=200, chunk_overlap=0)
    structured, nodes = orchestrator.extract_structured(
        raw_text="",
        metadata={"source": "pdf"},
        pages=[
            {"page_number": 1, "text": "Invoice Number: INV-PAGES-001"},
            {"page_number": 2, "text": "Line 1: 720711 | Coil | 10000 kg"},
        ],
    )

    assert structured.invoice_number == "INV-PAGES-001"
    assert len(nodes) >= 2
    page_numbers = {node.metadata.get("page_number") for node in nodes if isinstance(getattr(node, "metadata", None), dict)}
    assert 1 in page_numbers
    assert 2 in page_numbers
