from __future__ import annotations

import os
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")

import app.api.cbam as cbam_api
from tests.test_cbam_router import _client_with_fake_engine


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


def test_multiline_document_creates_two_goods_lines_and_emissions():
    client, _ = _client_with_fake_engine()
    fixture_path = (
        Path(__file__).resolve().parents[2]
        / "fixtures"
        / "documents"
        / "sample_invoice_TEST_MULTILINE.txt"
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
