from __future__ import annotations

from app.services.llama_structured_extractor import InvoiceSchema
from app.services.llama_structured_extractor import LineItemSchema
from app.services.llama_structured_extractor import compare_extractions


def test_compare_extractions_all_fields_match():
    rule_output = {
        "invoice": {"invoice_number": "INV-001", "invoice_date": "2025-01-15"},
        "lines": [{"cn_code": "720711"}, {"cn_code": "730890"}],
    }
    llama_output = InvoiceSchema(
        invoice_number="INV-001",
        invoice_date="2025-01-15",
        line_items=[
            LineItemSchema(cn_code="720711", quantity=10000),
            LineItemSchema(cn_code="730890", quantity=5000),
        ],
    )

    result = compare_extractions(rule_output, llama_output)
    assert result["match_score"] == 100.0
    assert result["differences"] == []


def test_compare_extractions_reports_differences():
    rule_output = {
        "invoice": {"invoice_number": "INV-A", "invoice_date": "2025-01-15"},
        "lines": [{"cn_code": "720711"}],
    }
    llama_output = InvoiceSchema(
        invoice_number="INV-B",
        invoice_date="2025-02-16",
        line_items=[],
    )

    result = compare_extractions(rule_output, llama_output)
    assert result["match_score"] == 0.0
    assert len(result["differences"]) == 3
