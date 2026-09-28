"""The compliance pack says whether a person has to review it, and why.

The narrative pipeline has always decided this — a figure in the narrative
that does not match the report package, a goods line with no calculation
method, a reconciliation warning left unaddressed — and fired the Slack alert
on it. But the pack returned to the caller carried neither the decision nor the
reasons, so Arbor could not show that a pack needed review, nor tell the
customer. Both now travel with the pack.
"""
from __future__ import annotations

from fastapi.testclient import TestClient
from main import app
from shared_auth.testing import make_test_token

import app.api.cbam_compliance as route
import app.services.narrative as narrative

client = TestClient(app)
CASE = "00000000-0000-0000-0000-0000000000aa"
PACKAGE = {"type": "cbam_report_package_v1", "data_quality": {"blocking": False}}
NARRATIVE = {"executive_summary": "s", "methodology": "m", "limitations": "l", "open_gaps": [], "results": {}}


def _headers(scopes=("narrative:run",)) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_test_token(sub='t', tenant_id='tenant-1', scopes=list(scopes))}"}


def _pipeline(monkeypatch, *, review: bool, failures: list[str]):
    monkeypatch.setattr(narrative, "fetch_report_packet", lambda case_id, kind, request: dict(PACKAGE))
    monkeypatch.setattr(
        narrative,
        "run_pipeline_stages",
        lambda **kw: {
            "case_id": CASE,
            "final_narrative_json": dict(NARRATIVE),
            "human_review_required": review,
            "stage_errors": [{"stage": "report_validator", "error": f} for f in failures],
        },
    )
    monkeypatch.setattr(
        route,
        "build_cbam_compliance_pack",
        lambda case_id, report_package, narrative: {"type": "cbam_compliance_pack_v1", "narrative": narrative},
    )


def test_a_pack_that_needs_review_says_so_and_why(monkeypatch):
    _pipeline(monkeypatch, review=True, failures=["Direct emissions in the narrative do not match the package."])
    res = client.post(f"/api/cbam/cases/{CASE}/compliance-pack", headers=_headers())
    assert res.status_code == 200, res.text
    assert res.json()["review"] == {
        "required": True,
        "reasons": ["Direct emissions in the narrative do not match the package."],
    }


def test_a_clean_pack_says_no_review_is_needed_but_keeps_its_findings(monkeypatch):
    # Completeness gaps are findings without requiring review.
    _pipeline(monkeypatch, review=False, failures=["A CPR claim has no verifier recorded."])
    res = client.post(f"/api/cbam/cases/{CASE}/compliance-pack", headers=_headers())
    assert res.json()["review"] == {"required": False, "reasons": ["A CPR claim has no verifier recorded."]}


def test_the_pack_still_needs_the_narrative_scope(monkeypatch):
    _pipeline(monkeypatch, review=False, failures=[])
    res = client.post(f"/api/cbam/cases/{CASE}/compliance-pack", headers=_headers(("cbam:read", "cbam:write")))
    assert res.status_code == 403
