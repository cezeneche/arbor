from __future__ import annotations

from pathlib import Path

import ledger_app.services.cbam_extractor as cbam_extractor


def test_llama_extractor_returns_dict(tmp_path: Path, monkeypatch):
    sample = tmp_path / "TEST_invoice.txt"
    sample.write_text(
        "Importer: Alpha Steel Ltd\n"
        "EORI: GB123456789\n"
        "CN code: 720711\n"
        "Net mass kg: 10000\n"
        "Origin country: TR\n"
        "Invoice date: 2025-01-15\n",
        encoding="utf-8",
    )

    class _StubExtractor:
        def extract(self, _file_path: str) -> dict:
            return {"status": "parsed", "structured": {}}

    monkeypatch.setattr(cbam_extractor, "_EXTRACTOR", _StubExtractor())
    result = cbam_extractor.extract(str(sample))
    assert isinstance(result, dict)
    assert "status" in result
    assert result["status"] in {"parsed", "error", "llamaindex_not_available"}


def test_parse_structured_response_extracts_emissions_fields():
    raw_text = (
        "Importer: Alpha Steel Ltd\n"
        "EORI: GB123456789\n"
        "Invoice Number: INV-EM-001\n"
        "Invoice Date: 2025-01-15\n"
        "CN code: 720711\n"
        "Net Mass KG: 10000\n"
        "Calculation Method: actual\n"
        "Direct Embedded Emissions (kgCO2e): 50000\n"
        "Indirect Embedded Emissions (kgCO2e): 10000\n"
    )
    structured = cbam_extractor._parse_structured_response("{}", raw_text)
    assert structured["method"] == "actual"
    assert structured["direct_embedded_kgco2e"] == 50000.0
    assert structured["indirect_embedded_kgco2e"] == 10000.0


def test_parse_structured_response_prefers_header_for_invoice_fields():
    raw_text = (
        "Invoice Number: INV-BODY-999\n"
        "Invoice Date: 2025-09-30\n"
        "Line 1: 720711 | Body line | 10000 kg | net mass kg 10000\n"
    )
    layout = {
        "header": "Invoice Number: INV-HDR-001\nInvoice Date: 2025-01-15",
        "body": "Line 1: 720711 | Body line | 10000 kg | net mass kg 10000",
        "full_text": raw_text,
    }

    structured = cbam_extractor._parse_structured_response("{}", raw_text, layout=layout)
    assert structured["invoice_number"] == "INV-HDR-001"
    assert structured["invoice_date"] == "2025-01-15"


def test_build_extraction_payload_prefers_body_for_line_items():
    raw_text = (
        "Line 1: 999999 | Wrong fallback line | 1 kg | net mass kg 1\n"
        "Noise footer text\n"
    )
    layout = {
        "header": "Invoice Number: INV-HDR-002\nInvoice Date: 2025-01-16",
        "body": (
            "Line 1: 720711 | Hot rolled steel coil | 10000 kg | net mass kg 10000\n"
            "Line 2: 730890 | Structural steel section | 5000 kg | net mass kg 5000"
        ),
        "full_text": raw_text,
    }

    payload = cbam_extractor._build_extraction_payload(raw_text, structured={}, layout=layout)
    cn_codes = {line["cn_code"] for line in payload["lines"]}
    assert len(payload["lines"]) == 2
    assert cn_codes == {"720711", "730890"}
