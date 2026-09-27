"""Whose case it is, and what a retried post adds, over HTTP against Postgres.

Every Arbor organisation reaches Nucleos with the same service token, so the
tenant check sees one tenant. Case reuse keyed on tenant, importer and period
alone therefore handed one organisation's case to another that declared the
same EORI for the same quarter — and a UK case to an EU filing for it. Arbor
now names the owning organisation (owner_ref), and reuse is scoped to it and to
the jurisdiction.

Shipments and goods lines had no idempotency at all. When Nucleos committed one
and the response was lost, Arbor recorded no progress and posted it again, and
the case gained a second copy of the goods. A client_ref makes the retry return
the row the first attempt created.
"""
# ruff: noqa: F811 — fixtures are imported from test_full_pipeline and requested by name.
from __future__ import annotations

from uuid import uuid4

from api.tests.test_full_pipeline import (  # noqa: F401 — fixtures are used by name
    _IMPORTER_EORI,
    _IMPORTER_NAME,
    _auth_headers,
    api_client,
    cleanup_cases,
)


def _case(client, headers, **over) -> dict:
    body = {
        "importer_eori": _IMPORTER_EORI,
        "importer_name": _IMPORTER_NAME,
        "reporting_year": 2027,
        "reporting_quarter": 1,
        "jurisdiction": "UK",
        **over,
    }
    resp = client.post("/api/cbam/cases", json=body, headers=headers)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def _shipment(client, headers, case_id: str, **over) -> dict:
    body = {"cbam_case_id": case_id, "origin_country": "IN", **over}
    resp = client.post("/api/cbam/shipments", json=body, headers=headers)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def _goods_line(client, headers, shipment_id: str, **over) -> dict:
    body = {
        "shipment_id": shipment_id,
        "cn_code": "72081000",
        "product_description": "Hot-rolled coil",
        "net_mass_kg": 24_000,
        **over,
    }
    resp = client.post("/api/cbam/goods-lines", json=body, headers=headers)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def _count(sql: str, **params) -> int:
    from ledger_app.api.cbam._shared import engine
    from sqlalchemy import text

    with engine.begin() as conn:
        return int(conn.execute(text(sql), params).scalar() or 0)




def test_two_organisations_declaring_the_same_importer_get_separate_cases(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))  # one shared service identity

    first = _case(api_client, headers, owner_ref="org-a")
    second = _case(api_client, headers, owner_ref="org-b")
    cleanup_cases.extend([first["id"], second["id"]])

    assert first["id"] != second["id"]


def test_the_same_organisation_gets_its_own_case_back(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))

    first = _case(api_client, headers, owner_ref="org-a")
    cleanup_cases.append(first["id"])
    second = _case(api_client, headers, owner_ref="org-a")

    assert second["id"] == first["id"]


def test_a_uk_and_an_eu_filing_for_the_same_quarter_are_separate_cases(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))

    uk = _case(api_client, headers, owner_ref="org-a", jurisdiction="UK")
    eu = _case(api_client, headers, owner_ref="org-a", jurisdiction="EU")
    cleanup_cases.extend([uk["id"], eu["id"]])

    assert uk["id"] != eu["id"]
    assert eu["jurisdiction"] == "EU"


def test_an_owned_case_is_never_returned_to_a_caller_naming_no_owner(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))

    owned = _case(api_client, headers, owner_ref="org-a")
    anonymous = _case(api_client, headers)
    cleanup_cases.extend([owned["id"], anonymous["id"]])

    assert anonymous["id"] != owned["id"]




def test_a_retried_shipment_returns_the_first_one(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    case = _case(api_client, headers, owner_ref="org-a")
    cleanup_cases.append(case["id"])

    first = _shipment(api_client, headers, case["id"], client_ref="doc-1:shipment:IN")
    second = _shipment(api_client, headers, case["id"], client_ref="doc-1:shipment:IN")

    assert second["id"] == first["id"]
    assert _count("SELECT count(*) FROM cbam.cbam_shipments WHERE case_id = :c", c=case["id"]) == 1


def test_a_different_client_ref_is_a_different_shipment(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    case = _case(api_client, headers, owner_ref="org-a")
    cleanup_cases.append(case["id"])

    india = _shipment(api_client, headers, case["id"], client_ref="doc-1:shipment:IN")
    turkey = _shipment(api_client, headers, case["id"], origin_country="TR", client_ref="doc-1:shipment:TR")

    assert india["id"] != turkey["id"]


def test_a_retried_goods_line_returns_the_first_one(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    case = _case(api_client, headers, owner_ref="org-a")
    cleanup_cases.append(case["id"])
    shipment = _shipment(api_client, headers, case["id"], client_ref="doc-1:shipment:IN")

    first = _goods_line(api_client, headers, shipment["id"], client_ref="doc-1:line:0")
    second = _goods_line(api_client, headers, shipment["id"], client_ref="doc-1:line:0")

    assert second["id"] == first["id"]
    assert (
        _count("SELECT count(*) FROM cbam.cbam_goods_lines WHERE shipment_id = :s", s=shipment["id"]) == 1
    )


def test_goods_lines_without_a_client_ref_are_still_created_each_time(api_client, cleanup_cases):
    # Callers that send no key keep today's behaviour: every post is a new line.
    headers = _auth_headers(str(uuid4()))
    case = _case(api_client, headers, owner_ref="org-a")
    cleanup_cases.append(case["id"])
    shipment = _shipment(api_client, headers, case["id"])

    first = _goods_line(api_client, headers, shipment["id"])
    second = _goods_line(api_client, headers, shipment["id"])

    assert second["id"] != first["id"]
