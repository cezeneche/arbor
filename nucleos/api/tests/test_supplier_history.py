"""A supplier's earlier emissions figures, beside the one on a goods line.

GET /api/cbam/suppliers/{supplier_eori}/see-history could not work: its request
parameter was untyped (so FastAPI read it as a required query parameter), it
selected columns the table does not have, and nothing ever wrote the table. It
is replaced by a goods-line route that reads history from the emissions already
recorded — so it cannot drift from them — and scopes it to the organisation that
owns the case, because every Arbor organisation reaches Nucleos as one tenant.

The deviation check is the reconciler's existing B2 rule
(check_supplier_see_consistency), fed real history for the first time.
"""
# ruff: noqa: F811 — fixtures are imported from test_full_pipeline and requested by name.
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from api.tests.test_full_pipeline import (  # noqa: F401 — fixtures are used by name
    _auth_headers,
    api_client,
    cleanup_cases,
)


def _line(client, headers, cleanup, *, owner: str, quarter: int, direct_kg: int, installation: str | None = "NO-INST-1"):
    """A case with one aluminium goods line of 100 t and a supplier emissions figure."""
    case = client.post(
        "/api/cbam/cases",
        json={
            "importer_eori": "GB123456789000",
            "reporting_year": 2027,
            "reporting_quarter": quarter,
            "owner_ref": owner,
        },
        headers=headers,
    )
    assert case.status_code in (200, 201), case.text
    cleanup.append(case.json()["id"])
    shipment = client.post(
        "/api/cbam/shipments",
        json={"cbam_case_id": case.json()["id"], "origin_country": "NO"},
        headers=headers,
    )
    body = {"shipment_id": shipment.json()["id"], "cn_code": "76011000", "net_mass_kg": 100000}
    if installation:
        body["installation_id"] = installation
    line = client.post("/api/cbam/goods-lines", json=body, headers=headers)
    assert line.status_code == 201, line.text
    assert client.post(
        "/api/cbam/emissions",
        json={
            "goods_line_id": line.json()["id"],
            "direct_emissions_kgco2e": direct_kg,
            "calculation_method": "actual",
            "version": 1,
        },
        headers=headers,
    ).status_code == 201
    return line.json()["id"]


def test_a_line_is_compared_with_its_suppliers_earlier_figures(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    for quarter, kg in ((1, 180000), (2, 190000), (3, 185000)):
        _line(api_client, headers, cleanup_cases, owner="org-a", quarter=quarter, direct_kg=kg)
    current = _line(api_client, headers, cleanup_cases, owner="org-a", quarter=4, direct_kg=300000)

    res = api_client.get(f"/api/cbam/goods-lines/{current}/supplier-history", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["installation_id"] == "NO-INST-1"
    assert [h["reporting_period"] for h in body["history"]] == ["2027-Q1", "2027-Q2", "2027-Q3"]
    assert [Decimal(h["see_tco2e_per_t"]) for h in body["history"]] == [Decimal("1.8"), Decimal("1.9"), Decimal("1.85")]
    assert Decimal(body["current_see_tco2e_per_t"]) == Decimal(3)
    assert body["flagged"] is True
    assert Decimal(body["rolling_mean"]) == Decimal("1.85")


def test_another_organisations_figures_are_not_history(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    for quarter in (1, 2, 3):
        _line(api_client, headers, cleanup_cases, owner="org-b", quarter=quarter, direct_kg=180000)
    current = _line(api_client, headers, cleanup_cases, owner="org-a", quarter=4, direct_kg=300000)

    body = api_client.get(f"/api/cbam/goods-lines/{current}/supplier-history", headers=headers).json()
    assert body["history"] == []
    assert body["flagged"] is False


def test_too_little_history_is_not_flagged(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    _line(api_client, headers, cleanup_cases, owner="org-a", quarter=1, direct_kg=180000)
    current = _line(api_client, headers, cleanup_cases, owner="org-a", quarter=2, direct_kg=300000)

    body = api_client.get(f"/api/cbam/goods-lines/{current}/supplier-history", headers=headers).json()
    assert len(body["history"]) == 1
    assert body["flagged"] is False


def test_a_line_with_no_installation_says_so(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    current = _line(api_client, headers, cleanup_cases, owner="org-a", quarter=1, direct_kg=180000, installation=None)

    body = api_client.get(f"/api/cbam/goods-lines/{current}/supplier-history", headers=headers).json()
    assert body["installation_id"] is None
    assert body["history"] == []
    assert body["note"]


def test_another_tenants_goods_line_is_not_found(api_client, cleanup_cases):
    current = _line(api_client, _auth_headers(str(uuid4())), cleanup_cases, owner="org-a", quarter=1, direct_kg=180000)
    res = api_client.get(f"/api/cbam/goods-lines/{current}/supplier-history", headers=_auth_headers(str(uuid4())))
    assert res.status_code == 404


def test_the_broken_route_is_gone(api_client):
    paths = {getattr(r, "path", "") for r in api_client.app.routes}
    assert "/api/cbam/suppliers/{supplier_eori}/see-history" not in paths
