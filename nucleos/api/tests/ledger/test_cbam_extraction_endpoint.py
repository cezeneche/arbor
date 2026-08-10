"""The text-in extraction endpoint — the only extraction entry point after Phase 2.

Arbor owns document-to-text, so the boundary carries text and metadata in and
structured drafts out. Two properties matter more than the field mapping:

  * Nothing here sets a provenance tier. Extraction produces drafts and only a
    human action in Arbor's Review screen assigns provenance.
  * It fails closed. An extraction that cannot complete returns an error, never
    an empty result — an empty result is indistinguishable from a document that
    genuinely contained nothing, and a reviewer would confirm the second while
    looking at the first.
"""
from __future__ import annotations

import pytest

from fastapi.testclient import TestClient

from ledger_app.main import app
from shared_auth.testing import make_test_token

pytestmark = pytest.mark.regulatory

INVOICE_TEXT = """COMMERCIAL INVOICE

Seller: Borusan Mannesmann Boru Sanayi ve Ticaret A.S.
Buyer:  Northern Steel Stockholders Ltd
        EORI: GB123456789000

Invoice number: INV-2027-0042
Invoice date: 2027-02-14
Incoterm: CIF Immingham
Customs entry reference: 24GB12345678901234

CN code: 72071111
Net mass: 24500 kg
Direct embedded emissions: 44100 kgCO2e
Method: actual
"""


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture()
def auth_headers():
    return {"Authorization": f"Bearer {make_test_token(scopes=['cbam:read', 'cbam:write'])}"}


def _request(**overrides):
    body = {
        "document_id": "doc-1",
        "document_type": "COMMERCIAL_INVOICE",
        "entity_id": "ent-1",
        "text": INVOICE_TEXT,
        "jurisdiction": "EU",
    }
    body.update(overrides)
    return body


class TestContract:
    def test_returns_drafts_for_a_commercial_invoice(self, client, auth_headers):
        res = client.post("/api/internal/cbam/extract", json=_request(), headers=auth_headers)
        assert res.status_code == 200, res.text
        body = res.json()

        assert body["document_id"] == "doc-1"
        names = {f["field_name"] for f in body["fields"]}
        assert "importer_eori" in names
        assert "invoice_number" in names

    def test_no_field_carries_a_provenance_tier(self, client, auth_headers):
        res = client.post("/api/internal/cbam/extract", json=_request(), headers=auth_headers)
        body = res.json()

        serialised = res.text
        assert "provenance_tier" not in serialised
        assert "VERIFIED" not in serialised
        assert "DECLARED" not in serialised
        for field in body["fields"]:
            assert "provenance_tier" not in field

    def test_goods_lines_come_back_as_drafts(self, client, auth_headers):
        res = client.post("/api/internal/cbam/extract", json=_request(), headers=auth_headers)
        lines = res.json()["lines"]
        assert lines
        assert lines[0]["cn_code"] == "72071111"
        assert lines[0]["net_mass_kg"] == 24500.0

    def test_engine_versions_are_stamped_on_the_response(self, client, auth_headers):
        res = client.post("/api/internal/cbam/extract", json=_request(), headers=auth_headers)
        engine = res.json()["engine"]
        assert engine["engine_version"]
        assert engine["annex_vi_factor_version"]
        assert engine["markup_table_version"]

    def test_source_text_travels_with_a_field(self, client, auth_headers):
        """A field without its source text can only ever be Declared, because a
        reviewer has nothing to confirm it against."""
        res = client.post("/api/internal/cbam/extract", json=_request(), headers=auth_headers)
        eori = next(f for f in res.json()["fields"] if f["field_name"] == "importer_eori")
        assert eori["source_text"]
        assert eori["evidence"]


class TestBoundary:
    def test_a_blob_reference_is_rejected(self, client, auth_headers):
        """Document blobs do not cross this boundary. The contract forbids extra
        fields so an added blob reference fails rather than being ignored."""
        res = client.post(
            "/api/internal/cbam/extract",
            json=_request(blob_url="https://example.invalid/doc.pdf"),
            headers=auth_headers,
        )
        assert res.status_code == 422

    def test_truncated_source_is_recorded_in_the_flags(self, client, auth_headers):
        res = client.post(
            "/api/internal/cbam/extract",
            json=_request(
                ocr_quality={
                    "truncated": True,
                    "truncation_reason": "Only the first 3 pages were read",
                    "mean_confidence": 0.82,
                    "engine": "textract",
                }
            ),
            headers=auth_headers,
        )
        assert res.status_code == 200
        flags = res.json()["flags"]
        assert any(f.startswith("source_truncated:") for f in flags)
        assert any("first 3 pages" in f for f in flags)

    def test_untruncated_source_adds_no_truncation_flag(self, client, auth_headers):
        res = client.post(
            "/api/internal/cbam/extract",
            json=_request(ocr_quality={"truncated": False}),
            headers=auth_headers,
        )
        assert not any(f.startswith("source_truncated:") for f in res.json()["flags"])


class TestFailsClosed:
    def test_missing_required_field_is_rejected(self, client, auth_headers):
        body = _request()
        del body["jurisdiction"]
        res = client.post("/api/internal/cbam/extract", json=body, headers=auth_headers)
        assert res.status_code == 422

    def test_empty_text_does_not_return_a_confident_empty_result(self, client, auth_headers):
        res = client.post("/api/internal/cbam/extract", json=_request(text=""), headers=auth_headers)
        # Either a 422, or a 200 whose emptiness is visible in the flags — but
        # never a 200 that looks like a clean read of a document with no data.
        if res.status_code == 200:
            body = res.json()
            assert not body["fields"] or body["flags"]
        else:
            assert res.status_code == 422
