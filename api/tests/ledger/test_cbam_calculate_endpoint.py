"""The calculation endpoint: confirmed goods lines in, computed declaration out.

Phase 3. Synchronous and pure — it works without a database, which is only true
because the CPR persistence helpers moved to cpr_repository.

Two properties carry the weight:

  * Both axes travel. emissions_method is what the engine chose;
    provenance_tier is echoed back untouched from what a human set in Arbor's
    Review screen. Neither derives from the other.
  * It fails closed. A line that cannot be calculated fails the declaration
    rather than being dropped from it — a total short by one goods line looks
    exactly like a complete one, and the number is what gets filed.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from ledger_app.main import app
from shared_auth.testing import make_test_token

pytestmark = pytest.mark.regulatory


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture()
def auth_headers():
    return {"Authorization": f"Bearer {make_test_token(scopes=['cbam:read', 'cbam:write'])}"}


def _payload(**overrides):
    body = {
        "case_reference": "CASE-1",
        "entity_id": "ent-1",
        "jurisdiction": "EU",
        "reporting_year": 2027,
        "lines": [
            {
                "line_id": "gl-1",
                "cn_code": "72071111",
                "net_mass_kg": 24500,
                "provenance_tier": "DECLARED",
            }
        ],
    }
    body.update(overrides)
    return body


class TestCalculation:
    def test_computes_a_default_line(self, client, auth_headers):
        res = client.post("/api/internal/calculate", json=_payload(), headers=auth_headers)
        assert res.status_code == 200, res.text
        line = res.json()["lines"][0]
        assert line["emissions_method"] == "DEFAULT"
        assert line["embedded_tco2e"] > 0

    def test_the_2027_markup_reaches_the_figure(self, client, auth_headers):
        res = client.post("/api/internal/calculate", json=_payload(), headers=auth_headers)
        assert res.json()["lines"][0]["markup_fraction"] == pytest.approx(0.20)

    def test_both_axes_travel_and_stay_distinct(self, client, auth_headers):
        res = client.post("/api/internal/calculate", json=_payload(), headers=auth_headers)
        line = res.json()["lines"][0]
        assert line["emissions_method"] == "DEFAULT"
        assert line["provenance_tier"] == "DECLARED"

    def test_provenance_is_echoed_never_recomputed(self, client, auth_headers):
        """A mill certificate can be ACTUAL method and DECLARED provenance. If
        Nucleos derived one from the other, this would come back VERIFIED."""
        res = client.post(
            "/api/internal/calculate",
            json=_payload(
                lines=[{
                    "line_id": "gl-1",
                    "cn_code": "72071111",
                    "net_mass_kg": 24500,
                    "direct_embedded_kgco2e": 44100,
                    "indirect_embedded_kgco2e": 3200,
                    "supplier_direct_confidence": 0.95,
                    "supplier_indirect_confidence": 0.95,
                    "provenance_tier": "DECLARED",
                }],
            ),
            headers=auth_headers,
        )
        line = res.json()["lines"][0]
        assert line["emissions_method"] == "ACTUAL"
        assert line["provenance_tier"] == "DECLARED"

    def test_rejected_methods_are_recorded(self, client, auth_headers):
        res = client.post("/api/internal/calculate", json=_payload(), headers=auth_headers)
        rejected = res.json()["lines"][0]["rejected_methods"]
        assert {r["method"] for r in rejected} == {"ACTUAL", "ESTIMATED"}
        assert all(r["reason"] and r["regulation_ref"] for r in rejected)

    def test_the_decision_trace_travels(self, client, auth_headers):
        res = client.post("/api/internal/calculate", json=_payload(), headers=auth_headers)
        steps = [a["step"] for a in res.json()["lines"][0]["decision_trace"]]
        assert "annex_vi_lookup" in steps

    def test_totals_sum_the_lines(self, client, auth_headers):
        res = client.post(
            "/api/internal/calculate",
            json=_payload(lines=[
                {"line_id": "a", "cn_code": "72071111", "net_mass_kg": 24500,
                 "provenance_tier": "DECLARED"},
                {"line_id": "b", "cn_code": "72085100", "net_mass_kg": 18000,
                 "provenance_tier": "VERIFIED"},
            ]),
            headers=auth_headers,
        )
        body = res.json()
        assert body["total_embedded_tco2e"] == pytest.approx(
            sum(line["embedded_tco2e"] for line in body["lines"])
        )


class TestVersionStamping:
    def test_versions_are_on_the_response_itself(self, client, auth_headers):
        engine = client.post(
            "/api/internal/calculate", json=_payload(), headers=auth_headers
        ).json()["engine"]
        assert engine["engine_version"]
        assert engine["annex_vi_factor_version"]
        assert engine["markup_table_version"]
        assert engine["regulation_reference"]


class TestFailsClosed:
    def test_an_uncalculable_line_fails_the_declaration(self, client, auth_headers):
        res = client.post(
            "/api/internal/calculate",
            json=_payload(lines=[
                {"line_id": "a", "cn_code": "72071111", "net_mass_kg": 24500,
                 "provenance_tier": "DECLARED"},
                {"line_id": "bad", "cn_code": "72071111", "net_mass_kg": -5,
                 "provenance_tier": "DECLARED"},
            ]),
            headers=auth_headers,
        )
        assert res.status_code == 422

    def test_a_line_without_provenance_is_rejected(self, client, auth_headers):
        """Provenance is set by a human before calculation. A line arriving
        without it means the review step was skipped."""
        res = client.post(
            "/api/internal/calculate",
            json=_payload(lines=[
                {"line_id": "a", "cn_code": "72071111", "net_mass_kg": 24500},
            ]),
            headers=auth_headers,
        )
        assert res.status_code == 422

    def test_an_empty_declaration_is_rejected(self, client, auth_headers):
        res = client.post("/api/internal/calculate", json=_payload(lines=[]), headers=auth_headers)
        assert res.status_code == 422
