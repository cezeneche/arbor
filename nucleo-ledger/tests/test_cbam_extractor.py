from __future__ import annotations

from pathlib import Path

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
