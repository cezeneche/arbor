from __future__ import annotations

from decimal import Decimal
from pathlib import Path

from ledger_app.testing import _client_with_fake_engine


def test_explain_metric_recomputes_total_and_matches_summary(monkeypatch, tmp_path):
    monkeypatch.setenv("SNAPSHOT_STORE_DIR", str(tmp_path / "snapshots"))

    client, _ = _client_with_fake_engine()

    case_res = client.post(
        "/api/cbam/cases",
        json={
            "importer_eori": "GBEXP123456",
            "reporting_year": 2025,
            "reporting_quarter": 1,
        },
    )
    assert case_res.status_code == 201
    case_id = case_res.json()["id"]

    shipment_res = client.post(
        "/api/cbam/shipments",
        json={
            "cbam_case_id": case_id,
            "origin_country": "CN",
            "customs_procedure": "40",
        },
    )
    assert shipment_res.status_code == 201
    shipment_id = shipment_res.json()["id"]

    goods_res = client.post(
        "/api/cbam/goods-lines",
        json={
            "shipment_id": shipment_id,
            "cn_code": "720711",
            "product_description": "Hot rolled steel coil",
            "net_mass_kg": 10000,
        },
    )
    assert goods_res.status_code == 201
    goods_line_id = goods_res.json()["id"]

    em_res = client.post(
        "/api/cbam/emissions",
        json={
            "goods_line_id": goods_line_id,
            "direct_emissions_kgco2e": 50000,
            "indirect_emissions_kgco2e": 10000,
            "calculation_method": "actual",
            "version": 1,
        },
    )
    assert em_res.status_code == 201

    report = client.get(f"/api/cbam/cases/{case_id}/report-package")
    assert report.status_code == 200

    explain = client.get(
        f"/api/cbam/cases/{case_id}/explain",
        params={"metric": "total_embedded_emissions_kgco2e"},
    )
    assert explain.status_code == 200, explain.text

    body = explain.json()
    assert body["metric"] == "total_embedded_emissions_kgco2e"
    assert body["integrity"]["snapshot_hash"]
    assert Decimal(body["total_recomputed"]) == Decimal(body["summary_value"])
    assert body["matches_summary"] is True


def test_explain_field_returns_evidence_even_when_bbox_missing(monkeypatch, tmp_path):
    monkeypatch.setenv("SNAPSHOT_STORE_DIR", str(tmp_path / "snapshots"))
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    client, _ = _client_with_fake_engine()
    fixture_path = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "documents"
        / "sample_invoice_TEST.txt"
    )

    draft = client.post(
        "/api/cbam/drafts/from-document",
        files={"file": (fixture_path.name, fixture_path.read_bytes(), "text/plain")},
    )
    assert draft.status_code == 201, draft.text
    case_id = draft.json()["created"]["case_id"]

    explain = client.get(
        f"/api/cbam/cases/{case_id}/explain",
        params={"field": "invoice.invoice_number"},
    )
    assert explain.status_code == 200, explain.text

    body = explain.json()
    assert body["field"] == "invoice.invoice_number"
    assert isinstance(body["evidence"], list)
    assert body["evidence"]
    assert any(atom.get("field") == "invoice.invoice_number" for atom in body["evidence"])
    # For plain text extraction there is no spatial grounding; bbox must remain null.
    assert any(atom.get("bbox") is None for atom in body["evidence"])
