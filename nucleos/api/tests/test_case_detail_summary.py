"""What the case detail response carries, over HTTP against Postgres.

Origin, net mass and exposure are attached by _enrich_cases_with_liability,
which only the list endpoint called. So a case page showed "—" for all three
while the goods table under it showed the same figures — the data was there,
the detail response just never carried it.
"""
# ruff: noqa: F811 — fixtures are imported from test_full_pipeline and requested by name.
from __future__ import annotations

from uuid import uuid4

import pytest

from api.tests.test_full_pipeline import (  # noqa: F401 — fixtures are used by name
    _auth_headers,
    _post_case,
    _post_goods_line,
    _post_shipment,
    api_client,
    cleanup_cases,
)


@pytest.fixture()
def case_with_goods(api_client, cleanup_cases):
    auth = _auth_headers(str(uuid4()))
    case = _post_case(api_client, auth)
    cleanup_cases.append(case["id"])
    shipment = _post_shipment(api_client, auth, case["id"], origin_country="TR")
    _post_goods_line(api_client, auth, case["id"], shipment["id"])
    return case["id"], auth


def _detail(api_client, case_id: str, auth: dict) -> dict:
    res = api_client.get(f"/api/cbam/cases/{case_id}", headers=auth)
    assert res.status_code == 200, res.text
    return res.json()


def test_the_case_states_where_the_goods_came_from(api_client, case_with_goods):
    case_id, auth = case_with_goods
    assert _detail(api_client, case_id, auth)["origin_country"] == "TR"


def test_the_case_states_its_total_net_mass(api_client, case_with_goods):
    case_id, auth = case_with_goods
    assert float(_detail(api_client, case_id, auth)["total_net_mass_kg"]) > 0


def test_the_case_says_why_no_exposure_is_shown_when_it_cannot_be(api_client, case_with_goods):
    # Withholding a figure is right; saying nothing at all is not. The page has
    # to be able to explain the dash.
    case_id, auth = case_with_goods
    detail = _detail(api_client, case_id, auth)
    assert "estimated_liability_gbp" in detail
    if detail["estimated_liability_gbp"] is None:
        assert detail.get("estimated_liability_unavailable")
