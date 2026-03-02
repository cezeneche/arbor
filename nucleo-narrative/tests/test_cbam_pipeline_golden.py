from pathlib import Path
import sys

import pytest
from starlette.testclient import TestClient

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))


@pytest.fixture()
def client():
    from narrative_app.main import app

    return TestClient(app)


def test_cbam_packet_generates_narrative(monkeypatch, client):
    cbam_packet = {
        "type": "cbam_report_package_v1",
        "case": {
            "id": "CASE-CBAM-001",
            "importer_name": "Alpha Steel Ltd",
            "importer_eori": "GB123456789",
            "reporting_year": 2025,
            "reporting_quarter": 1,
        },
        "shipments": [{"shipment": {"id": "S1"}, "goods_lines": []}],
        "summary": {
            "total_goods_lines": 2,
            "total_net_mass_kg": 15000,
            "total_direct_emissions_kgco2e": 50000,
            "total_indirect_emissions_kgco2e": 10000,
            "total_embedded_emissions_kgco2e": 60000,
        },
    }

    from narrative_app.api import pipeline as pipeline_module

    def fake_fetch_report_package(_case_id: str):
        raise AssertionError("Legacy fetch should not be used for packet_kind=cbam")

    def fake_fetch_cbam_report_package(case_id: str):
        assert case_id == cbam_packet["case"]["id"]
        return cbam_packet

    def fail_openai(_packet: dict):
        raise AssertionError("OpenAI draft should not be called for cbam_report_package_v1")

    def fail_claude(_draft_obj: dict):
        raise AssertionError("Claude review should not be called for cbam_report_package_v1")

    def fail_gemini(_packet: dict, _narrative_obj: dict):
        raise AssertionError("Gemini gate should not be called for cbam_report_package_v1")

    monkeypatch.setattr(pipeline_module, "fetch_report_package", fake_fetch_report_package)
    monkeypatch.setattr(pipeline_module, "fetch_cbam_report_package", fake_fetch_cbam_report_package)
    monkeypatch.setattr(pipeline_module, "generate_draft", fail_openai)
    monkeypatch.setattr(pipeline_module, "review_narrative", fail_claude)
    monkeypatch.setattr(pipeline_module, "gate", fail_gemini)

    case_id = cbam_packet["case"]["id"]
    resp = client.post(f"/api/cases/{case_id}/narrative/pipeline?packet_kind=cbam")
    assert resp.status_code == 200, resp.text

    body = resp.json()
    for key in [
        "draft_openai_json",
        "claude_review_json",
        "gemini_gate",
        "final_narrative_json",
    ]:
        assert key in body

    assert body["human_review_required"] is False
    assert body["final_narrative_json"]["type"] == "cbam_narrative_v1"
    assert body["final_narrative_json"]["case_id"] == case_id
    assert body["final_narrative_json"]["totals"]["shipments_count"] == 1


def test_cbam_packet_blocking_returns_422(monkeypatch, client):
    cbam_packet = {
        "type": "cbam_report_package_v1",
        "case": {"id": "CASE-CBAM-BLOCK"},
        "data_quality": {
            "missing": ["goods_line:GL1:missing_emissions"],
            "warnings": [],
            "score": 40.0,
            "blocking": True,
        },
    }

    from narrative_app.api import pipeline as pipeline_module

    def fake_fetch_report_package(_case_id: str):
        raise AssertionError("Legacy fetch should not be used for packet_kind=cbam")

    def fake_fetch_cbam_report_package(case_id: str):
        assert case_id == cbam_packet["case"]["id"]
        return cbam_packet

    monkeypatch.setattr(pipeline_module, "fetch_report_package", fake_fetch_report_package)
    monkeypatch.setattr(pipeline_module, "fetch_cbam_report_package", fake_fetch_cbam_report_package)

    case_id = cbam_packet["case"]["id"]
    resp = client.post(f"/api/cases/{case_id}/narrative/pipeline?packet_kind=cbam")
    assert resp.status_code == 422, resp.text
    assert resp.json() == {
        "message": "Data quality blocking issues",
        "case_id": case_id,
        "data_quality": cbam_packet["data_quality"],
    }
