from __future__ import annotations

from pathlib import Path

from app.services.cbam_extractor import _parse_structured_response
from app.services.cbam_extractor import extract


def test_llama_extractor_returns_dict(tmp_path: Path):
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

    result = extract(str(sample))
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
    structured = _parse_structured_response("{}", raw_text)
    assert structured["method"] == "actual"
    assert structured["direct_embedded_kgco2e"] == 50000.0
    assert structured["indirect_embedded_kgco2e"] == 10000.0
