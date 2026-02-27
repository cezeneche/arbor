from __future__ import annotations

import json
from pathlib import Path

import pytest


def test_cbam_e2e_demo_compliance_pack_fixture_schema():
    repo_root = Path(__file__).resolve().parents[2]
    fixture_path = repo_root / "fixtures" / "ledger" / "cbam_compliance_pack_TEST-002.json"

    if not fixture_path.exists():
        pytest.skip(f"Fixture not generated yet: {fixture_path}")

    data = json.loads(fixture_path.read_text(encoding="utf-8"))

    for key in ["type", "case_id", "generated_at", "report_package", "narrative", "data_quality_flags", "tables"]:
        assert key in data

    assert data["type"] == "cbam_compliance_pack_v1"
    assert isinstance(data["case_id"], str) and data["case_id"]
    assert isinstance(data["report_package"], dict)
    assert isinstance(data["narrative"], dict)
    assert isinstance(data["data_quality_flags"], list)
    assert isinstance(data["tables"], dict)

    assert "goods_lines" in data["tables"]
    assert "totals" in data["tables"]
    assert isinstance(data["tables"]["goods_lines"], list)
    assert isinstance(data["tables"]["totals"], dict)

    totals = data["tables"]["totals"]
    for key in [
        "total_goods_lines",
        "total_net_mass_kg",
        "total_direct_emissions_kgco2e",
        "total_indirect_emissions_kgco2e",
        "total_embedded_emissions_kgco2e",
    ]:
        assert key in totals
        assert isinstance(totals[key], (int, float))

    assert totals["total_embedded_emissions_kgco2e"] == pytest.approx(
        totals["total_direct_emissions_kgco2e"] + totals["total_indirect_emissions_kgco2e"]
    )
