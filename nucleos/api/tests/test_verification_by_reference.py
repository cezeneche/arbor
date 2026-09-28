"""Verification statements are Arbor documents; Nucleos records a reference.

An accredited verifier's statement is what lets a supplier's emissions figure
go on a return as actual, verified data, and what supports a carbon price
relief claim. Both upload routes used to take the PDF and store it in Nucleos's
own storage — but documents are Arbor's (integration rule 4): Arbor stores the
file, certifies its provenance and computes its hash, and Nucleos records which
document it was, who verified, and the hash to detect a later change.
"""
# ruff: noqa: F811 — fixtures are imported from test_full_pipeline and requested by name.
from __future__ import annotations

from uuid import uuid4

from sqlalchemy import text

from api.tests.test_full_pipeline import (  # noqa: F401 — fixtures are used by name
    _auth_headers,
    api_client,
    cleanup_cases,
)

SHA = "a1" * 32


def _goods_line(client, headers, *, method: str = "actual") -> tuple[str, str]:
    case = client.post(
        "/api/cbam/cases",
        json={"importer_eori": "GB123456789000", "reporting_year": 2027, "reporting_quarter": 1},
        headers=headers,
    )
    assert case.status_code in (200, 201), case.text
    shipment = client.post(
        "/api/cbam/shipments", json={"cbam_case_id": case.json()["id"], "origin_country": "NO"}, headers=headers
    )
    assert shipment.status_code == 201, shipment.text
    line = client.post(
        "/api/cbam/goods-lines",
        json={"shipment_id": shipment.json()["id"], "cn_code": "76011000", "net_mass_kg": 200000},
        headers=headers,
    )
    assert line.status_code == 201, line.text
    emissions = client.post(
        "/api/cbam/emissions",
        json={
            "goods_line_id": line.json()["id"],
            "direct_emissions_kgco2e": 360000,
            "indirect_emissions_kgco2e": 520000,
            "calculation_method": method,
            "version": 1,
        },
        headers=headers,
    )
    assert emissions.status_code == 201, emissions.text
    return case.json()["id"], line.json()["id"]


def _reference(**over) -> dict:
    return {
        "verifier_name": "Carbon Assurance Ltd",
        "verifier_accreditation": "UKAS 9876",
        "document_ref": "arbor:document:doc-123",
        "document_sha256": SHA,
        **over,
    }


def _stored(goods_line_id: str) -> dict:
    from ledger_app.api.cbam._shared import engine

    with engine.begin() as conn:
        return dict(
            conn.execute(
                text(
                    "SELECT verification_status, verifier_name, verifier_accreditation, "
                    "verification_report_path, verification_report_hash "
                    "FROM cbam.cbam_goods_lines WHERE id = :id"
                ),
                {"id": goods_line_id},
            ).mappings().one()
        )


def test_the_emissions_statement_is_recorded_as_a_reference(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    case_id, line_id = _goods_line(api_client, headers)
    cleanup_cases.append(case_id)

    assert api_client.post(f"/api/cbam/goods-lines/{line_id}/request-verification", headers=headers).status_code == 200
    res = api_client.post(
        f"/api/cbam/goods-lines/{line_id}/upload-verification", json=_reference(), headers=headers
    )
    assert res.status_code == 200, res.text

    stored = _stored(line_id)
    assert stored["verification_status"] == "submitted"
    assert stored["verification_report_path"] == "arbor:document:doc-123"
    assert stored["verification_report_hash"] == SHA
    assert (stored["verifier_name"], stored["verifier_accreditation"]) == ("Carbon Assurance Ltd", "UKAS 9876")

    assert api_client.post(f"/api/cbam/goods-lines/{line_id}/verify", headers=headers).status_code == 200
    assert _stored(line_id)["verification_status"] == "verified"


def test_a_statement_that_is_not_a_sha256_is_refused(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    case_id, line_id = _goods_line(api_client, headers)
    cleanup_cases.append(case_id)
    api_client.post(f"/api/cbam/goods-lines/{line_id}/request-verification", headers=headers)

    res = api_client.post(
        f"/api/cbam/goods-lines/{line_id}/upload-verification",
        json=_reference(document_sha256="not-a-hash"),
        headers=headers,
    )
    assert res.status_code == 422
    assert _stored(line_id)["verification_status"] == "pending"


def test_a_file_upload_is_no_longer_accepted(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    case_id, line_id = _goods_line(api_client, headers)
    cleanup_cases.append(case_id)
    api_client.post(f"/api/cbam/goods-lines/{line_id}/request-verification", headers=headers)

    res = api_client.post(
        f"/api/cbam/goods-lines/{line_id}/upload-verification",
        files={"file": ("report.pdf", b"%PDF-1.4", "application/pdf")},
        data={"verifier_name": "X", "verifier_accreditation": "Y"},
        headers=headers,
    )
    assert res.status_code == 422
    assert _stored(line_id)["verification_report_path"] is None


def test_the_relief_statement_is_recorded_as_a_reference(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    case_id, line_id = _goods_line(api_client, headers)
    cleanup_cases.append(case_id)

    claim = api_client.post(
        "/api/cbam/cpr/claims",
        json={
            "goods_line_id": line_id,
            "origin_country_code": "NO",
            # Norway prices carbon through the EU ETS (EEA): its own CO2 tax is
            # not a scheme the UK recognises, and the claim is now refused.
            "qualifying_scheme_name": "EU Emissions Trading System (EU ETS)",
            "carbon_price_local_currency": "70",
            "local_currency_code": "EUR",
            "free_allocations_received": "0",
            "rebates_received": "0",
            "exchange_rate_to_gbp": "0.85",
            "exchange_rate_date": "2027-03-15",
            "cbam_liability_gbp": "19116",
            "verified_emissions_tco2e": "360",
        },
        headers=headers,
    )
    assert claim.status_code == 201, claim.text

    res = api_client.post(
        f"/api/cbam/cpr/upload-verification/{line_id}",
        json={"document_ref": "arbor:document:doc-456", "document_sha256": SHA},
        headers=headers,
    )
    assert res.status_code == 200, res.text

    from ledger_app.api.cbam._shared import engine

    with engine.begin() as conn:
        row = conn.execute(
            text(
                "SELECT verification_document_path, verification_document_hash "
                "FROM cbam.cbam_cpr_claims WHERE goods_line_id = :id"
            ),
            {"id": line_id},
        ).mappings().one()
    assert (row["verification_document_path"], row["verification_document_hash"]) == (
        "arbor:document:doc-456",
        SHA,
    )


# A verified statement only matters if it reaches the return. Both builders
# already knew how to report a verified line — the HMRC builder from a
# goods_line_id → reference map, the EU builder from verification_reference on
# the goods line — but neither was ever given one, so every supplier figure went
# on the return as unverified however it had been verified.

def _verified_line(client, headers, jurisdiction: str) -> tuple[str, str]:
    case = client.post(
        "/api/cbam/cases",
        json={
            "importer_eori": "GB123456789000",
            "importer_name": "Midlands Aluminium Ltd",
            "reporting_year": 2027,
            "reporting_quarter": 1,
            "jurisdiction": jurisdiction,
        },
        headers=headers,
    )
    assert case.status_code in (200, 201), case.text
    case_id = case.json()["id"]
    shipment = client.post(
        "/api/cbam/shipments",
        json={
            "cbam_case_id": case_id,
            "origin_country": "NO",
            "entry_reference": "MRN-2027-0001",
            "import_date": "2027-02-15",
        },
        headers=headers,
    )
    assert shipment.status_code == 201, shipment.text
    line = client.post(
        "/api/cbam/goods-lines",
        json={"shipment_id": shipment.json()["id"], "cn_code": "76011000", "net_mass_kg": 200000},
        headers=headers,
    )
    assert line.status_code == 201, line.text
    line_id = line.json()["id"]
    assert client.post(
        "/api/cbam/emissions",
        json={
            "goods_line_id": line_id,
            "direct_emissions_kgco2e": 360000,
            "indirect_emissions_kgco2e": 520000,
            "calculation_method": "actual",
            "version": 1,
        },
        headers=headers,
    ).status_code == 201
    client.post(f"/api/cbam/goods-lines/{line_id}/request-verification", headers=headers)
    assert client.post(
        f"/api/cbam/goods-lines/{line_id}/upload-verification", json=_reference(), headers=headers
    ).status_code == 200
    assert client.post(f"/api/cbam/goods-lines/{line_id}/verify", headers=headers).status_code == 200
    return case_id, line_id


def test_a_verified_line_goes_on_the_hmrc_return_as_actual_verified(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    case_id, _ = _verified_line(api_client, headers, "UK")
    cleanup_cases.append(case_id)

    res = api_client.post(
        f"/api/cbam/cases/{case_id}/hmrc-return",
        json={
            "importer_vat_number": "GB123456789",
            "importer_address": {"line1": "1 Mill Lane", "city": "Leeds", "postcode": "LS1 1AA"},
            "accuracy_declaration": True,
            "cbam_rate_override": "53.10",
        },
        headers=headers,
    )
    assert res.status_code == 200, res.text
    lines = [gl for c in res.json()["consignments"] for gl in c["goods_lines"]]
    assert [gl["emissions_method"] for gl in lines] == ["actual_verified"]
    assert "Carbon Assurance Ltd" in lines[0]["verification_reference"]
    assert "UKAS 9876" in lines[0]["verification_reference"]


def test_a_verified_line_carries_its_reference_into_the_eu_declaration(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    case_id, _ = _verified_line(api_client, headers, "EU")
    cleanup_cases.append(case_id)

    res = api_client.post(f"/api/cbam/cases/{case_id}/eu-xml", headers=headers)
    assert res.status_code == 200, res.text
    assert "verificationReference" in res.text
    assert "Carbon Assurance Ltd" in res.text
