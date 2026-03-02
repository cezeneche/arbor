from __future__ import annotations

import copy

from narrative_app.services import claude_reviewer


def _sample_draft() -> dict:
    return {
        "executive_summary": "Summary",
        "methodology": "Method",
        "results": {
            "total_emissions_kgco2e": 100.0,
            "scope_1_kgco2e": 40.0,
            "scope_2_kgco2e": 60.0,
            "intensity_kgco2e_per_unit": 2.5,
        },
        "limitations": "None",
        "open_gaps": [],
    }


def test_claude_review_skips_when_api_key_missing(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    draft = _sample_draft()
    result = claude_reviewer.review_narrative(copy.deepcopy(draft))

    for key in ["executive_summary", "methodology", "results", "limitations", "open_gaps"]:
        assert result[key] == draft[key]
    assert result["_review_status"] == "skipped"
    assert result["_review_provider"] == "claude"
    assert result["_review_reason"] == "missing_api_key"


def test_claude_review_skips_when_sdk_unavailable(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    def _raise_module_not_found(_name: str):
        raise ModuleNotFoundError("No module named 'anthropic'")

    monkeypatch.setattr(claude_reviewer.importlib, "import_module", _raise_module_not_found)

    draft = _sample_draft()
    result = claude_reviewer.review_narrative(copy.deepcopy(draft))

    for key in ["executive_summary", "methodology", "results", "limitations", "open_gaps"]:
        assert result[key] == draft[key]
    assert result["_review_status"] == "skipped"
    assert result["_review_provider"] == "claude"
    assert result["_review_reason"] == "sdk_unavailable"
