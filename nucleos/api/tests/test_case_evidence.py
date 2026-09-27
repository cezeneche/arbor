"""Evidence for a case, sent by Arbor, so "explain this figure" has something to read.

Explain-by-field reads the evidence recorded in a case's repaired_v1 snapshot.
The only route that ever wrote it was /drafts/from-parsed-invoice, which Arbor
never used and which is gone, so explain had nothing to say about any Arbor
case. POST /api/cbam/cases/{id}/evidence records what Arbor read from the
document — the value, the text it came from, the confidence — keyed to Nucleos's
own goods-line ids, so two documents on one case never collide on "lines[0]".

Explain also gains the tenant check it never had.
"""
# ruff: noqa: F811 — fixtures are imported from test_full_pipeline and requested by name.
from __future__ import annotations

from uuid import uuid4

from api.tests.test_full_pipeline import (  # noqa: F401 — fixtures are used by name
    _auth_headers,
    api_client,
    cleanup_cases,
)


def _case(client, headers, quarter: int = 1) -> tuple[str, str]:
    case = client.post(
        "/api/cbam/cases",
        json={"importer_eori": "GB123456789000", "reporting_year": 2027, "reporting_quarter": quarter},
        headers=headers,
    )
    assert case.status_code in (200, 201), case.text
    shipment = client.post(
        "/api/cbam/shipments", json={"cbam_case_id": case.json()["id"], "origin_country": "IN"}, headers=headers
    )
    line = client.post(
        "/api/cbam/goods-lines",
        json={"shipment_id": shipment.json()["id"], "cn_code": "72081000", "net_mass_kg": 24000},
        headers=headers,
    )
    assert line.status_code == 201, line.text
    return case.json()["id"], line.json()["id"]


def _atom(field: str, value, snippet: str, source: str = "arbor_review") -> dict:
    return {"field": field, "value": value, "source": source, "confidence": 0.8, "snippet": snippet}


def test_explain_reads_the_evidence_arbor_sent(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    case_id, line_id = _case(api_client, headers)
    cleanup_cases.append(case_id)

    res = api_client.post(
        f"/api/cbam/cases/{case_id}/evidence",
        json={
            "source_ref": "arbor:document:doc-1",
            "evidence": [
                _atom(f"goods_lines.{line_id}.net_mass_kg", 24000, "Net mass | 24 000 kg"),
                _atom("case.importer_eori", "GB123456789000", "EORI: GB123456789000"),
            ],
        },
        headers=headers,
    )
    assert res.status_code == 200, res.text

    explain = api_client.get(
        f"/api/cbam/cases/{case_id}/explain",
        params={"field": f"goods_lines.{line_id}.net_mass_kg"},
        headers=headers,
    )
    assert explain.status_code == 200, explain.text
    body = explain.json()
    assert body["field"] == f"goods_lines.{line_id}.net_mass_kg"
    assert [atom["snippet"] for atom in body["evidence"]] == ["Net mass | 24 000 kg"]


def test_a_second_document_adds_to_the_evidence_rather_than_replacing_it(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    case_id, line_id = _case(api_client, headers)
    cleanup_cases.append(case_id)
    field = f"goods_lines.{line_id}.net_mass_kg"

    for doc, snippet in (("doc-1", "Net mass | 24 000 kg"), ("doc-2", "Nettomasse 24000 kg")):
        assert api_client.post(
            f"/api/cbam/cases/{case_id}/evidence",
            json={"source_ref": f"arbor:document:{doc}", "evidence": [_atom(field, 24000, snippet)]},
            headers=headers,
        ).status_code == 200

    body = api_client.get(
        f"/api/cbam/cases/{case_id}/explain", params={"field": field}, headers=headers
    ).json()
    assert sorted(atom["snippet"] for atom in body["evidence"]) == ["Net mass | 24 000 kg", "Nettomasse 24000 kg"]


def test_evidence_for_a_goods_line_on_another_case_is_refused(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    case_id, _ = _case(api_client, headers)
    # Another quarter, so case reuse cannot hand back the same case.
    other_case, other_line = _case(api_client, headers, quarter=2)
    cleanup_cases.extend([case_id, other_case])

    res = api_client.post(
        f"/api/cbam/cases/{case_id}/evidence",
        json={"source_ref": "arbor:document:doc-1", "evidence": [_atom(f"goods_lines.{other_line}.net_mass_kg", 1, "x")]},
        headers=headers,
    )
    assert res.status_code == 422


def test_another_tenant_cannot_add_or_read_evidence(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))
    case_id, line_id = _case(api_client, headers)
    cleanup_cases.append(case_id)
    field = f"goods_lines.{line_id}.net_mass_kg"
    api_client.post(
        f"/api/cbam/cases/{case_id}/evidence",
        json={"source_ref": "arbor:document:doc-1", "evidence": [_atom(field, 24000, "Net mass | 24 000 kg")]},
        headers=headers,
    )

    stranger = _auth_headers(str(uuid4()))
    assert api_client.post(
        f"/api/cbam/cases/{case_id}/evidence",
        json={"source_ref": "x", "evidence": [_atom(field, 1, "x")]},
        headers=stranger,
    ).status_code == 404
    assert api_client.get(
        f"/api/cbam/cases/{case_id}/explain", params={"field": field}, headers=stranger
    ).status_code == 404
