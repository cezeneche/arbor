"""Carbon price relief claims: which scheme, which line, which claim counts.

Relief reduces what an importer pays HMRC, so three things about a claim have
to be right before it reaches the return:

- the scheme is one the UK recognises for the goods' country of origin;
- the claim is against a goods line this tenant owns, from that country;
- only the latest claim on a line counts. Claiming again replaces the earlier
  claim — it used to be added to it, doubling the relief.
"""
# ruff: noqa: F811 — fixtures are imported from test_full_pipeline and requested by name.
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from api.tests.test_full_pipeline import (  # noqa: F401 — fixtures are used by name
    _auth_headers,
    api_client,
    cleanup_cases,
    requires_postgres,
)

pytestmark = requires_postgres

EU_ETS = "EU Emissions Trading System (EU ETS)"


def _goods_line(client, headers, *, origin: str = "DE") -> tuple[str, str]:
    case = client.post(
        "/api/cbam/cases",
        json={"importer_eori": "GB123456789000", "reporting_year": 2027, "reporting_quarter": 2},
        headers=headers,
    )
    assert case.status_code in (200, 201), case.text
    shipment = client.post(
        "/api/cbam/shipments",
        json={"cbam_case_id": case.json()["id"], "origin_country": origin, "entry_reference": "MRN-CPR-1"},
        headers=headers,
    )
    assert shipment.status_code == 201, shipment.text
    line = client.post(
        "/api/cbam/goods-lines",
        json={"shipment_id": shipment.json()["id"], "cn_code": "72081000", "net_mass_kg": 100000},
        headers=headers,
    )
    assert line.status_code == 201, line.text
    return case.json()["id"], line.json()["id"]


def _claim(line_id: str, **over) -> dict:
    return {
        "goods_line_id": line_id,
        "origin_country_code": "DE",
        "qualifying_scheme_name": EU_ETS,
        "carbon_price_local_currency": "70",
        "local_currency_code": "EUR",
        "free_allocations_received": "0",
        "rebates_received": "0",
        "verified_emissions_tco2e": "100",
        "exchange_rate_to_gbp": "0.85",
        "exchange_rate_date": "2027-04-15",
        "cbam_liability_gbp": "100000",
        **over,
    }


def test_only_the_latest_claim_on_a_line_reduces_the_return(api_client, cleanup_cases):
    from app.services.cpr_repository import get_cpr_by_consignment_db
    from ledger_app.api.cbam._shared import engine, set_tenant_context

    tenant = str(uuid4())
    headers = _auth_headers(tenant)
    case_id, line_id = _goods_line(api_client, headers)
    cleanup_cases.append(case_id)

    first = api_client.post("/api/cbam/cpr/claims", json=_claim(line_id), headers=headers)
    assert first.status_code == 201, first.text
    # The importer mistyped the price and claims again.
    second = api_client.post(
        "/api/cbam/cpr/claims", json=_claim(line_id, carbon_price_local_currency="60"), headers=headers
    )
    assert second.status_code == 201, second.text

    with engine.begin() as conn:
        set_tenant_context(conn, tenant)
        relief = get_cpr_by_consignment_db(conn, case_id, tenant)
    assert relief == {"MRN-CPR-1": Decimal(str(second.json()["cpr_amount_gbp"])).quantize(Decimal("0.01"))}


def test_a_scheme_the_uk_does_not_recognise_for_the_origin_is_refused(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    case_id, line_id = _goods_line(api_client, headers, origin="NO")
    cleanup_cases.append(case_id)

    res = api_client.post(
        "/api/cbam/cpr/claims",
        json=_claim(line_id, origin_country_code="NO", qualifying_scheme_name="Norway CO2 tax",
                    local_currency_code="NOK"),
        headers=headers,
    )
    assert res.status_code == 422, res.text
    assert "Norway CO2 tax" in res.text


def test_a_claim_must_name_the_goods_line_origin(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    case_id, line_id = _goods_line(api_client, headers, origin="TR")
    cleanup_cases.append(case_id)

    # EU ETS qualifies for Germany, but these goods came from Turkey.
    res = api_client.post("/api/cbam/cpr/claims", json=_claim(line_id, origin_country_code="DE"), headers=headers)
    assert res.status_code == 422, res.text


def test_a_claim_against_another_tenants_goods_line_is_refused(api_client, cleanup_cases):
    owner = _auth_headers(str(uuid4()))
    case_id, line_id = _goods_line(api_client, owner)
    cleanup_cases.append(case_id)

    res = api_client.post("/api/cbam/cpr/claims", json=_claim(line_id), headers=_auth_headers(str(uuid4())))
    assert res.status_code == 404, res.text


def test_each_scheme_says_which_currency_its_price_is_in(api_client):
    headers = _auth_headers(str(uuid4()))

    def schemes(country: str) -> dict[str, str | None]:
        res = api_client.get(f"/api/cbam/cpr/qualifying-schemes?country={country}", headers=headers)
        assert res.status_code == 200, res.text
        return {s["scheme_name"]: s["currency_code"] for s in res.json()["schemes"]}

    assert schemes("DE") == {EU_ETS: "EUR"}
    assert schemes("CH") == {"Swiss Emissions Trading Scheme (Swiss ETS)": "CHF"}
    assert schemes("SE") == {EU_ETS: "EUR", "Swedish Carbon Tax": "SEK"}
