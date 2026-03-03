from __future__ import annotations

import os
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")

import ledger_app.api.cbam as cbam_api
import ledger_app.services.cbam_extractor as cbam_extractor
from ledger_app.testing import _client_with_fake_engine
from ledger_app.services.llama_structured_extractor import InvoiceSchema
from ledger_app.services.llama_structured_extractor import LineItemSchema


def test_cbam_draft_from_document_upload_returns_expected_keys(monkeypatch):
    client, _ = _client_with_fake_engine()
    fixture_path = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "documents"
        / "sample_invoice_TEST.txt"
    )

    monkeypatch.setattr(
        cbam_api,
        "extract_cbam_document",
        lambda _path: {
            "status": "parsed",
            "importer": {"name": "Alpha Steel Ltd", "eori": "GB123456789"},
            "invoice": {
                "invoice_number": "INV-TEST-001",
                "invoice_date": "2025-01-15",
                "origin_country": "CN",
                "incoterm": "FOB",
                "entry_reference": "ER-001",
            },
            "lines": [
                {
                    "cn_code": "720711",
                    "description": "Hot rolled steel coil",
                    "quantity": 10000,
                    "quantity_unit": "kg",
                    "net_mass_kg": 10000,
                }
            ],
            "emissions": {
                "method": "actual",
                "direct_embedded_kgco2e": 50000,
                "indirect_embedded_kgco2e": 10000,
            },
        },
    )

    response = client.post(
        "/api/cbam/drafts/from-document",
        files={"file": (fixture_path.name, fixture_path.read_bytes(), "text/plain")},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert "parsed" in body
    assert "created" in body
    assert "warnings" in body
    assert "case_id" in body["created"]
    assert "shipment_id" in body["created"]
    assert "goods_line_ids" in body["created"]
    assert "emissions_ids" in body["created"]
    assert "extraction_validation" in body
    assert len(body["created"]["goods_line_ids"]) >= 1
    assert len(body["created"]["emissions_ids"]) >= 1


def test_cbam_draft_from_document_without_emissions_keeps_emissions_ids_empty(monkeypatch):
    client, _ = _client_with_fake_engine()
    fixture_path = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "documents"
        / "sample_invoice_TEST.txt"
    )

    monkeypatch.setattr(
        cbam_api,
        "extract_cbam_document",
        lambda _path: {
            "status": "parsed",
            "importer": {"name": "Alpha Steel Ltd", "eori": "GB123456789"},
            "invoice": {
                "invoice_number": "INV-TEST-NO-EM",
                "invoice_date": "2025-01-15",
                "origin_country": "CN",
            },
            "lines": [
                {
                    "cn_code": "720711",
                    "description": "Hot rolled steel coil",
                    "quantity": 10000,
                    "quantity_unit": "kg",
                    "net_mass_kg": 10000,
                }
            ],
            "emissions": None,
        },
    )

    response = client.post(
        "/api/cbam/drafts/from-document",
        files={"file": (fixture_path.name, fixture_path.read_bytes(), "text/plain")},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert len(body["created"]["goods_line_ids"]) >= 1
    assert body["created"]["emissions_ids"] == []


def test_numeric_string_coercion(monkeypatch):
    client, conn = _client_with_fake_engine()
    fixture_path = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "documents"
        / "sample_invoice_TEST.txt"
    )

    monkeypatch.setattr(
        cbam_api,
        "extract_cbam_document",
        lambda _path: {
            "status": "parsed",
            "importer": {"name": "Alpha Steel Ltd", "eori": "GB123456789"},
            "invoice": {"invoice_number": "INV-TEST-COERCE", "invoice_date": "2025-01-15"},
            "lines": [
                {
                    "cn_code": "720711",
                    "quantity": "10000.0",
                    "quantity_unit": "kg",
                    "net_mass_kg": "10000.0",
                }
            ],
            "emissions": {
                "method": "actual",
                "direct_embedded_kgco2e": "50000.0",
                "indirect_embedded_kgco2e": "10000.0",
            },
        },
    )

    response = client.post(
        "/api/cbam/drafts/from-document",
        files={"file": (fixture_path.name, fixture_path.read_bytes(), "text/plain")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    goods_line_id = body["created"]["goods_line_ids"][0]
    emissions_id = body["created"]["emissions_ids"][0]

    assert isinstance(conn.goods_lines[goods_line_id]["quantity"], float)
    assert isinstance(conn.emissions[emissions_id]["direct_embedded_kgco2e"], float)
    assert isinstance(conn.emissions[emissions_id]["indirect_embedded_kgco2e"], float)


def test_invalid_numeric_raises_422(monkeypatch):
    client, _ = _client_with_fake_engine()
    fixture_path = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "documents"
        / "sample_invoice_TEST.txt"
    )

    monkeypatch.setattr(
        cbam_api,
        "extract_cbam_document",
        lambda _path: {
            "status": "parsed",
            "importer": {"name": "Alpha Steel Ltd", "eori": "GB123456789"},
            "invoice": {"invoice_number": "INV-TEST-BADNUM", "invoice_date": "2025-01-15"},
            "lines": [
                {
                    "cn_code": "720711",
                    "quantity": "ten thousand",
                    "quantity_unit": "kg",
                    "net_mass_kg": "10000.0",
                }
            ],
        },
    )

    response = client.post(
        "/api/cbam/drafts/from-document",
        files={"file": (fixture_path.name, fixture_path.read_bytes(), "text/plain")},
    )
    assert response.status_code == 422
    body = response.json()
    assert body["stage"] == "extract"
    assert body["detail"] == "Invalid numeric value for quantity"


def test_multiline_document_creates_two_goods_lines_and_emissions(monkeypatch):
    client, _ = _client_with_fake_engine()
    fixture_path = (
        Path(__file__).resolve().parents[2]
        / "fixtures"
        / "documents"
        / "sample_invoice_TEST_MULTILINE.txt"
    )
    monkeypatch.setattr(
        cbam_api,
        "extract_cbam_document",
        lambda _path: {
            "status": "parsed",
            "importer": {"name": "Alpha Steel Ltd", "eori": "GB123456789"},
            "invoice": {
                "invoice_number": "INV-TEST-MULTI-001",
                "invoice_date": "2025-01-15",
                "origin_country": "TR",
                "incoterm": "FOB",
                "entry_reference": "ENTRY-MULTI-001",
            },
            "lines": [
                {
                    "cn_code": "720711",
                    "description": "Hot rolled steel coil",
                    "quantity": 10000,
                    "quantity_unit": "kg",
                    "net_mass_kg": 10000,
                    "method": "actual",
                    "direct_embedded_kgco2e": 50000,
                    "indirect_embedded_kgco2e": 10000,
                },
                {
                    "cn_code": "730890",
                    "description": "Structural steel section",
                    "quantity": 5000,
                    "quantity_unit": "kg",
                    "net_mass_kg": 5000,
                    "method": "actual",
                    "direct_embedded_kgco2e": 25000,
                    "indirect_embedded_kgco2e": 5000,
                },
            ],
            "emissions": None,
        },
    )

    response = client.post(
        "/api/cbam/drafts/from-document",
        files={"file": (fixture_path.name, fixture_path.read_bytes(), "text/plain")},
    )
    assert response.status_code == 201, response.text
    body = response.json()

    assert len(body["created"]["goods_line_ids"]) == 2
    assert len(body["created"]["emissions_ids"]) == 2

    case_id = body["created"]["case_id"]
    report = client.get(f"/api/cbam/cases/{case_id}/report-package")
    assert report.status_code == 200, report.text
    report_body = report.json()

    assert len(report_body["shipments"]) == 1
    goods_lines = report_body["shipments"][0]["goods_lines"]
    assert len(goods_lines) == 2
    assert all(gl["latest_emissions"] is not None for gl in goods_lines)
    cn_codes = {gl["goods_line"]["cn_code"] for gl in goods_lines}
    assert cn_codes == {"720711", "730890"}

    second = client.post(
        "/api/cbam/drafts/from-document",
        files={"file": (fixture_path.name, fixture_path.read_bytes(), "text/plain")},
    )
    assert second.status_code == 201, second.text
    second_body = second.json()
    assert len(second_body["created"]["goods_line_ids"]) == 2
    assert len(second_body["created"]["emissions_ids"]) == 2
    assert sorted(second_body["created"]["goods_line_ids"]) == sorted(body["created"]["goods_line_ids"])
    assert sorted(second_body["created"]["emissions_ids"]) == sorted(body["created"]["emissions_ids"])
    assert any("Reused existing shipment" in w for w in second_body["warnings"])

    report_second = client.get(f"/api/cbam/cases/{case_id}/report-package")
    assert report_second.status_code == 200, report_second.text
    goods_lines_second = report_second.json()["shipments"][0]["goods_lines"]
    assert len(goods_lines_second) == 2


def test_from_document_uses_layout_header_for_invoice_and_body_for_lines(monkeypatch):
    client, _ = _client_with_fake_engine()
    fixture_path = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "documents"
        / "sample_invoice_TEST_LAYOUT.txt"
    )

    def _fake_extract_document_from_upload(filename: str, content_type: str | None, data: bytes) -> dict:
        raw_text = data.decode("utf-8")
        return {
            "raw_text": raw_text,
            "ocr_lines": [],
            "layout": {
                "blocks": [
                    {
                        "type": "header",
                        "text": "Invoice Number: INV-HDR-100\nInvoice Date: 2025-02-20",
                        "lines_idx": [0, 1],
                    },
                    {
                        "type": "body",
                        "text": (
                            "Line 1: 720711 | Hot rolled steel coil | 10000 kg | net mass kg 10000\n"
                            "Line 2: 730890 | Structural steel section | 5000 kg | net mass kg 5000"
                        ),
                        "lines_idx": [2, 3],
                    },
                ]
            },
        }

    class _RuleBasedExtractor:
        def extract(self, file_path: str, layout: dict | None = None) -> dict:
            raw_text = cbam_extractor._read_raw_text(Path(file_path))
            structured = cbam_extractor._parse_structured_response("{}", raw_text, layout=layout)
            payload = cbam_extractor._build_extraction_payload(raw_text, structured, layout=layout)
            payload["status"] = "parsed"
            return payload

    monkeypatch.setattr(cbam_api, "extract_document_from_upload", _fake_extract_document_from_upload)
    monkeypatch.setattr(cbam_extractor, "_EXTRACTOR", _RuleBasedExtractor())

    response = client.post(
        "/api/cbam/drafts/from-document",
        files={"file": (fixture_path.name, fixture_path.read_bytes(), "text/plain")},
    )
    assert response.status_code == 201, response.text
    body = response.json()

    assert body["parsed"]["invoice"]["invoice_number"] == "INV-HDR-100"
    assert body["parsed"]["invoice"]["invoice_date"] == "2025-02-20"
    assert len(body["created"]["goods_line_ids"]) == 2


def test_from_document_extraction_validation_uses_mocked_llama(monkeypatch):
    client, _ = _client_with_fake_engine()
    fixture_path = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "documents"
        / "sample_invoice_TEST.txt"
    )

    monkeypatch.setattr(
        cbam_api,
        "extract_cbam_document",
        lambda _path: {
            "status": "parsed",
            "importer": {"name": "Alpha Steel Ltd", "eori": "GB123456789"},
            "invoice": {"invoice_number": "INV-VALID-001", "invoice_date": "2025-01-15"},
            "lines": [
                {
                    "cn_code": "720711",
                    "description": "Hot rolled steel coil",
                    "quantity": 10000,
                    "quantity_unit": "kg",
                    "net_mass_kg": 10000,
                }
            ],
            "emissions": None,
        },
    )
    monkeypatch.setattr(
        cbam_api,
        "LlamaOrchestrator",
        lambda: type(
            "_StubOrchestrator",
            (),
            {
                "extract_structured": staticmethod(
                    lambda _text, metadata=None, pages=None: (
                        InvoiceSchema(
                            importer_name="Alpha Steel Ltd",
                            invoice_number="INV-VALID-001",
                            invoice_date="2025-01-15",
                            line_items=[LineItemSchema(cn_code="720711", quantity=10000)],
                        ),
                        ["node-1"],
                    )
                )
            },
        )(),
    )

    response = client.post(
        "/api/cbam/drafts/from-document",
        files={"file": (fixture_path.name, fixture_path.read_bytes(), "text/plain")},
    )
    assert response.status_code == 201, response.text
    validation = response.json()["extraction_validation"]
    assert validation["match_score"] == 100.0
    assert validation["differences"] == []
    assert validation["gemini_fallback_used"] is False


def test_from_document_data_quality_uses_final_payload_with_form_overrides(monkeypatch):
    client, _ = _client_with_fake_engine()
    fixture_path = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "documents"
        / "sample_invoice_CONFLICT_TEST.txt"
    )

    monkeypatch.setattr(
        cbam_api,
        "extract_cbam_document",
        lambda _path: {
            "status": "parsed",
            "importer": {"name": "Unknown Importer", "eori": None},
            "invoice": {
                "invoice_number": "INV-CONFLICT-001",
                "invoice_date": "2025-01-15",
                "origin_country": None,
                "incoterm": None,
                "entry_reference": None,
            },
            "lines": [
                {
                    "cn_code": "720711",
                    "description": "Conflicted steel line",
                    "quantity": None,
                    "quantity_unit": "kg",
                    "net_mass_kg": None,
                }
            ],
            "emissions": None,
        },
    )
    monkeypatch.setattr(
        cbam_api,
        "LlamaOrchestrator",
        lambda: type(
            "_StubOrchestrator",
            (),
            {
                "extract_structured": staticmethod(
                    lambda _text, metadata=None, pages=None: (
                        InvoiceSchema(
                            importer_name="Unknown Importer",
                            invoice_number="INV-CONFLICT-001",
                            invoice_date="2025-01-15",
                            origin_country=None,
                            line_items=[LineItemSchema(cn_code="720711", quantity=None)],
                        ),
                        ["node-1"],
                    )
                )
            },
        )(),
    )

    response = client.post(
        "/api/cbam/drafts/from-document",
        files={"file": (fixture_path.name, fixture_path.read_bytes(), "text/plain")},
        data={"importer_name": "Form Importer Ltd", "importer_eori": "GBFORM123456"},
    )
    assert response.status_code == 201, response.text
    dq = response.json()["extraction_validation"]["data_quality"]

    assert "case:importer_eori_missing" not in dq["missing"]
    assert "shipment:draft_shipment:origin_country_missing" in dq["missing"]
    assert "goods_line:draft_goods_0:mass_missing_or_non_positive" in dq["missing"]
    assert "goods_line:draft_goods_0:missing_emissions" in dq["missing"]


def test_from_document_uses_gemini_fallback_when_low_match_and_blocking(monkeypatch):
    client, _ = _client_with_fake_engine()
    fixture_path = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "documents"
        / "sample_invoice_CONFLICT_TEST.txt"
    )

    monkeypatch.setattr(cbam_api, "ENABLE_GEMINI_FALLBACK", True)
    monkeypatch.setattr(cbam_api, "GEMINI_MATCH_THRESHOLD", 0.4)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(
        cbam_api,
        "compare_extractions",
        lambda _rule, _llama: {"match_score": 0.0, "differences": ["forced_low_match"]},
    )
    monkeypatch.setattr(
        cbam_api,
        "extract_cbam_document",
        lambda _path: {
            "status": "parsed",
            "importer": {"name": "Unknown Importer", "eori": "GB123456789"},
            "invoice": {
                "invoice_number": "INV-CONFLICT-001",
                "invoice_date": "2025-01-15",
                "origin_country": None,
                "incoterm": None,
                "entry_reference": None,
            },
            "lines": [
                {
                    "cn_code": "720711",
                    "description": "Conflicted steel line",
                    "quantity": None,
                    "quantity_unit": "kg",
                    "net_mass_kg": None,
                }
            ],
            "emissions": None,
        },
    )
    monkeypatch.setattr(
        cbam_api,
        "LlamaOrchestrator",
        lambda: type(
            "_StubOrchestrator",
            (),
            {
                "extract_structured": staticmethod(
                    lambda _text, metadata=None, pages=None: (
                        InvoiceSchema(
                            importer_name="Unknown Importer",
                            invoice_number="INV-CONFLICT-001",
                            invoice_date="2025-01-15",
                            origin_country=None,
                            line_items=[LineItemSchema(cn_code="720711", quantity=None)],
                        ),
                        ["node-1"],
                    )
                )
            },
        )(),
    )
    monkeypatch.setattr(
        cbam_api,
        "extract_structured_with_gemini",
        lambda _text: {
            "importer_name": "Unknown Importer",
            "invoice_number": "INV-CONFLICT-001",
            "invoice_date": "2025-01-15",
            "origin_country": "TR",
            "line_items": [{"cn_code": "720711", "description": "Steel", "quantity": 1000}],
        },
    )

    response = client.post(
        "/api/cbam/drafts/from-document",
        files={"file": (fixture_path.name, fixture_path.read_bytes(), "text/plain")},
    )
    assert response.status_code == 201, response.text
    validation = response.json()["extraction_validation"]
    assert validation["gemini_fallback_used"] is True
    assert "gemini" in validation.get("fallback_sources", [])


def test_from_document_includes_invoice_evidence_without_hallucinated_bbox(monkeypatch):
    client, _ = _client_with_fake_engine()
    fixture_path = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "documents"
        / "sample_invoice_TEST.txt"
    )
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    response = client.post(
        "/api/cbam/drafts/from-document",
        files={"file": (fixture_path.name, fixture_path.read_bytes(), "text/plain")},
    )
    assert response.status_code == 201, response.text
    validation = response.json()["extraction_validation"]

    evidence = validation.get("evidence")
    assert isinstance(evidence, list)
    invoice_atoms = [atom for atom in evidence if atom.get("field") == "invoice.invoice_number"]
    assert invoice_atoms
    assert invoice_atoms[0].get("value") == "INV-TEST-001"
    assert invoice_atoms[0].get("bbox") is None
