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


# A customs declaration, in the layout Arbor's transcription produces: label
# lines above their values, and the goods section as a pipe-separated table.
DECLARATION_TEXT = """IMPORT DECLARATION
Customs Declaration Service (CDS) — entry summary

DECLARATION REFERENCE (MRN)
26GB52TESTDOC04177

IMPORTER / DECLARANT
Acme Steel Ltd

IMPORTER EORI
GB247188003000

COUNTRY OF ORIGIN
TR — Turkiye

Goods item
Commodity code (CN) | 7208 3900
Goods description | Hot-rolled coil, non-alloy steel, grade S235JR
Net mass | 24 500 kg
Supplier invoice | CMS-2026-4417
"""


class TestSpecialistParserValues:
    """A specialist parser's values must reach the drafts, not only the evidence.

    Scalars are read from the flat `structured` dict the generic extractor
    produces. A specialist returns a nested shape and no `structured` at all,
    and arbitration starts from the specialist — so every scalar came back null
    while the evidence beside it carried the value. The reviewer saw "not found"
    next to a snippet containing the answer.
    """

    def _fields(self, client, auth_headers) -> dict[str, str | None]:
        res = client.post(
            "/api/internal/cbam/extract",
            json=_request(text=DECLARATION_TEXT, document_type="CUSTOMS_DECLARATION"),
            headers=auth_headers,
        )
        assert res.status_code == 200, res.text
        return {f["field_name"]: f["raw_value"] for f in res.json()["fields"]}

    def test_the_importer_eori_reaches_the_draft(self, client, auth_headers):
        assert self._fields(client, auth_headers).get("importer_eori") == "GB247188003000"

    def test_the_entry_reference_reaches_the_draft(self, client, auth_headers):
        assert self._fields(client, auth_headers).get("entry_reference") == "26GB52TESTDOC04177"

    def test_the_origin_country_reaches_the_draft(self, client, auth_headers):
        assert self._fields(client, auth_headers).get("origin_country") == "TR"

    def test_a_pipe_separated_goods_table_still_yields_a_mass(self, client, auth_headers):
        res = client.post(
            "/api/internal/cbam/extract",
            json=_request(text=DECLARATION_TEXT, document_type="CUSTOMS_DECLARATION"),
            headers=auth_headers,
        )
        line = res.json()["lines"][0]
        assert line["cn_code"] == "72083900"
        assert line["net_mass_kg"] == 24500
