from __future__ import annotations

import importlib
from pathlib import Path
import sys


BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))


def test_gemini_gate_import_and_missing_key_graceful(monkeypatch):
    gemini_gate = importlib.import_module("narrative_app.services.gemini_gate")
    monkeypatch.setattr(gemini_gate.settings, "gemini_api_key", None, raising=False)

    packet = {
        "type": "report_package_v1",
        "results": {
            "total_kgco2e": 100.0,
            "scope_1_natural_gas_kgco2e": 40.0,
            "scope_2_electricity_kgco2e": 60.0,
            "kgco2e_per_unit": 2.5,
        },
    }
    narrative_json = {
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

    result = gemini_gate.gate(packet, narrative_json)
    assert result["approved"] is False
    assert any("GEMINI_API_KEY is missing" in issue.get("detail", "") for issue in result["issues"])
