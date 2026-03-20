from __future__ import annotations

import json
from pathlib import Path
import re
import sys

import pytest
from starlette.testclient import TestClient

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent
sys.path.insert(0, str(BASE_DIR))

FIXTURES_DIR = REPO_ROOT / "fixtures"
CBAM_REPORT_FIXTURE = FIXTURES_DIR / "ledger" / "cbam_report_package_TEST-001.json"
CBAM_NARRATIVE_FIXTURE = FIXTURES_DIR / "narrative" / "cbam_final_narrative_TEST-001.json"
CBAM_COMPLIANCE_FIXTURE = FIXTURES_DIR / "narrative" / "cbam_compliance_pack_TEST-001.json"


def load_json(path: Path):
    assert path.exists(), f"Missing fixture: {path}"
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture()
def client(make_auth_headers):
    from narrative_app.main import app

    return TestClient(app, headers=make_auth_headers(scopes=["narrative:run"]))


def test_cbam_compliance_pack_golden(monkeypatch, client):
    report_package = load_json(CBAM_REPORT_FIXTURE)
    final_narrative = load_json(CBAM_NARRATIVE_FIXTURE)
    expected = load_json(CBAM_COMPLIANCE_FIXTURE)

    import app.services.narrative as narrative_module
    from narrative_app.services import compliance_pack as compliance_service

    monkeypatch.setattr(
        narrative_module,
        "fetch_report_packet",
        lambda case_id, packet_kind, request: report_package if case_id == "TEST-CBAM" else {},
    )
    monkeypatch.setattr(
        narrative_module,
        "run_pipeline_stages",
        lambda *, case_id, packet_kind="cbam", request, background_tasks=None: {
            "case_id": case_id,
            "final_narrative_json": final_narrative,
            "human_review_required": False,
            "stage_errors": [],
        },
    )
    monkeypatch.setattr(
        compliance_service,
        "_now_utc_iso",
        lambda: "2026-03-01T10:00:00+00:00",
    )

    response = client.post("/api/cbam/cases/TEST-CBAM/compliance-pack")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body == expected
    assert "audit" in body
    assert re.fullmatch(r"[0-9a-f]{64}", str(body["audit"]["payload_hash"]))


def test_cbam_compliance_pack_blocking_returns_422(monkeypatch, client):
    blocking_packet = {
        "type": "cbam_report_package_v1",
        "case": {"id": "TEST-CBAM-BLOCK"},
        "data_quality": {
            "missing": ["shipment:SHIP1:origin_country_missing"],
            "warnings": [],
            "score": 50.0,
            "blocking": True,
        },
    }

    import app.services.narrative as narrative_module

    monkeypatch.setattr(
        narrative_module,
        "fetch_report_packet",
        lambda case_id, packet_kind, request: blocking_packet,
    )
    monkeypatch.setattr(
        narrative_module,
        "run_pipeline_stages",
        lambda **_: (_ for _ in ()).throw(AssertionError("Pipeline should not run when blocking=true")),
    )

    response = client.post("/api/cbam/cases/TEST-CBAM-BLOCK/compliance-pack")
    assert response.status_code == 422, response.text
    assert response.json() == {
        "message": "Data quality blocking issues",
        "case_id": "TEST-CBAM-BLOCK",
        "data_quality": blocking_packet["data_quality"],
    }
