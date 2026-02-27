import json
from pathlib import Path
import sys

import pytest
from starlette.testclient import TestClient

# --- Paths / fixtures ---
# This test should work whether you run pytest from repo root or from nucleo-narrative/
BASE_DIR = Path(__file__).resolve().parent.parent  # .../nucleo-narrative
REPO_ROOT = BASE_DIR.parent                       # .../scope3-agentic-platform

# Ensure nucleo-narrative/ is on sys.path so `import app` works when running pytest from elsewhere
sys.path.insert(0, str(BASE_DIR))

# Fixtures live at repo root
FIXTURES_DIR = REPO_ROOT / "fixtures"

# Some earlier moves may have placed fixtures directly under FIXTURES_DIR (without ledger/narrative subdirs)
LEDGER_FIXTURE = FIXTURES_DIR / "ledger" / "report_package_TEST-004.json"
EXPECTED_FINAL_FIXTURE = FIXTURES_DIR / "narrative" / "final_narrative_TEST-004.json"
CBAM_LEDGER_FIXTURE = FIXTURES_DIR / "ledger" / "cbam_report_package_TEST-CBAM.json"
CBAM_EXPECTED_FINAL_FIXTURE = FIXTURES_DIR / "narrative" / "final_narrative_TEST-CBAM.json"

if not LEDGER_FIXTURE.exists():
    alt = FIXTURES_DIR / "report_package_TEST-004.json"
    if alt.exists():
        LEDGER_FIXTURE = alt

if not EXPECTED_FINAL_FIXTURE.exists():
    alt = FIXTURES_DIR / "final_narrative_TEST-004.json"
    if alt.exists():
        EXPECTED_FINAL_FIXTURE = alt


def load_json(path: Path):
    assert path.exists(), f"Missing fixture: {path}"
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def assert_narrative_schema(final_obj: dict) -> None:
    required_keys = {
        "executive_summary",
        "methodology",
        "results",
        "limitations",
        "open_gaps",
    }
    assert required_keys.issubset(final_obj.keys()), (
        f"Missing keys: {required_keys - set(final_obj.keys())}"
    )

    assert isinstance(final_obj["executive_summary"], str)
    assert isinstance(final_obj["methodology"], str)
    assert isinstance(final_obj["limitations"], str)
    assert isinstance(final_obj["results"], dict)
    assert isinstance(final_obj["open_gaps"], list)


@pytest.fixture()
def client():
    # Import app lazily so fixture paths resolve and env isn't required at import time
    from app.main import app

    return TestClient(app)


def test_pipeline_golden(monkeypatch, client):
    """Golden test for the narrative pipeline.

    This test is OFFLINE + deterministic:
    - Uses the saved ledger report-package fixture instead of calling nucleo-ledger.
    - Stubs OpenAI/Claude/Gemini services so no network/API keys are required.
    - Asserts final_narrative_json matches the expected golden fixture exactly.
    """

    report_pkg = load_json(LEDGER_FIXTURE)
    expected_final = load_json(EXPECTED_FINAL_FIXTURE)

    # --- Patch dependencies where pipeline.py uses them (it imports directly) ---
    from app.api import pipeline as pipeline_module

    # 1) Ledger fetch: return fixture
    def fake_fetch_report_package(case_id: str):
        return report_pkg

    monkeypatch.setattr(pipeline_module, "fetch_report_package", fake_fetch_report_package)

    # 2) OpenAI draft: deterministic output
    def fake_openai_draft(packet: dict):
        return expected_final

    monkeypatch.setattr(pipeline_module, "generate_draft", fake_openai_draft)

    # 3) Claude review: passthrough
    def fake_claude_review(draft_obj: dict):
        return draft_obj

    monkeypatch.setattr(pipeline_module, "review_narrative", fake_claude_review)

    # 4) Gemini gate: approve
    def fake_gemini_gate(packet: dict, narrative_obj: dict):
        return {"approved": True, "issues": []}

    monkeypatch.setattr(pipeline_module, "gate", fake_gemini_gate)

    # --- Call pipeline ---
    case_id = report_pkg["case"]["id"]
    resp = client.post(f"/api/cases/{case_id}/narrative/pipeline")
    assert resp.status_code == 200, resp.text

    data = resp.json()

    # --- Assertions: schema + exact golden ---
    assert data.get("stage_errors") == [], f"stage_errors present: {data.get('stage_errors')}"
    assert data.get("human_review_required") is False

    final_obj = data.get("final_narrative_json")
    assert isinstance(final_obj, dict), "final_narrative_json must be an object"

    assert_narrative_schema(final_obj)

    # Results structure + numeric checks
    results = final_obj["results"]
    assert isinstance(results, dict), "results must be an object"

    for k in [
        "total_emissions_kgco2e",
        "scope_1_kgco2e",
        "scope_2_kgco2e",
        "intensity_kgco2e_per_unit",
    ]:
        assert k in results, f"Missing results.{k}"
        assert isinstance(results[k], (int, float)), f"results.{k} must be numeric"

    # Open gaps structure
    open_gaps = final_obj["open_gaps"]
    assert isinstance(open_gaps, list), "open_gaps must be a list"

    for i, gap in enumerate(open_gaps):
        assert isinstance(gap, dict), f"open_gaps[{i}] must be an object"
        for k in ["field", "issue", "current_confidence", "target_confidence"]:
            assert k in gap, f"Missing open_gaps[{i}].{k}"

    # Golden exact match
    assert final_obj == expected_final


def test_pipeline_golden_cbam(monkeypatch, client):
    cbam_packet = load_json(CBAM_LEDGER_FIXTURE)

    from app.api import pipeline as pipeline_module

    def fake_fetch_report_package(_case_id: str):
        raise AssertionError("Legacy fetch should not be used for packet_kind=cbam.")

    def fake_fetch_cbam_report_package(case_id: str):
        assert case_id == cbam_packet["case"]["id"]
        return cbam_packet

    def fail_openai(_packet: dict):
        raise AssertionError("OpenAI draft should not be called for cbam_report_package_v1.")

    def fail_claude(_draft_obj: dict):
        raise AssertionError("Claude review should not be called for cbam_report_package_v1.")

    def fail_gemini(_packet: dict, _narrative_obj: dict):
        raise AssertionError("Gemini gate should not be called for cbam_report_package_v1.")

    monkeypatch.setattr(pipeline_module, "fetch_report_package", fake_fetch_report_package)
    monkeypatch.setattr(pipeline_module, "fetch_cbam_report_package", fake_fetch_cbam_report_package)
    monkeypatch.setattr(pipeline_module, "generate_draft", fail_openai)
    monkeypatch.setattr(pipeline_module, "review_narrative", fail_claude)
    monkeypatch.setattr(pipeline_module, "gate", fail_gemini)

    case_id = cbam_packet["case"]["id"]
    resp = client.post(f"/api/cases/{case_id}/narrative/pipeline?packet_kind=cbam")
    assert resp.status_code == 200, resp.text

    data = resp.json()
    assert data.get("stage_errors") == []
    assert data.get("human_review_required") is False

    final_obj = data.get("final_narrative_json")
    assert isinstance(final_obj, dict)
    assert final_obj["type"] == "cbam_narrative_v1"
    assert final_obj["case_id"] == case_id
    assert "executive_summary" in final_obj
    assert "totals" in final_obj
    assert "risk_flags" in final_obj
