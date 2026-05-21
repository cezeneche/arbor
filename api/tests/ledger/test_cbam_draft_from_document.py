"""Tests for POST /api/cbam/drafts/from-document.

The endpoint now returns immediately with a stub case (background-task pattern):
    201  {created: {case_id, shipment_id: None, goods_line_ids: [], ...}, document_sha256}

The real extraction + DB writes happen in the background task.  Starlette's
TestClient runs background tasks synchronously before client.post() returns, so
tests can inspect FakeConnection state after the request to verify the pipeline ran.
"""
from __future__ import annotations

import os
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")

import ledger_app.api.cbam as cbam_api
from ledger_app.testing import _client_with_fake_engine


_FIXTURE_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "documents"


def _upload_bytes() -> bytes:
    return (_FIXTURE_DIR / "sample_invoice_TEST.txt").read_bytes()


def _upload_multiline_bytes() -> bytes:
    return (_FIXTURE_DIR / "sample_invoice_TEST_MULTILINE.txt").read_bytes()


class _FakeOrchestrator:
    """Minimal stand-in for llama_orchestrator that returns a fixed ingest_plan."""

    def __init__(self, ingest_plan: dict) -> None:
        self._plan = ingest_plan

    def __setattr__(self, name: str, value: object) -> None:
        object.__setattr__(self, name, value)

    def run_document_ingest_plan(self, **_kwargs: object) -> dict:
        return self._plan


def _make_ingest_plan(
    invoice_number: str = "INV-TEST-001",
    cn_code: str = "720711",
    mass: float | str = 10000,
    direct: float | str | None = 50000.0,
    indirect: float | str | None = 10000.0,
    has_emissions: bool = True,
    importer_name: str = "Alpha Steel Ltd",
    importer_eori: str = "GB123456789",
    origin_country: str = "CN",
    extra_lines: list[dict] | None = None,
) -> dict:
    emissions = None
    if has_emissions and direct is not None:
        emissions = {
            "method": "actual",
            "direct_embedded_kgco2e": direct,
            "indirect_embedded_kgco2e": indirect,
        }
    lines = [{
        "cn_code": cn_code,
        "description": "Hot rolled steel coil",
        "quantity": mass,
        "quantity_unit": "kg",
        "net_mass_kg": mass,
    }]
    if extra_lines:
        lines.extend(extra_lines)
    return {
        "raw_text": f"Invoice Number: {invoice_number}\nCN code: {cn_code}\n",
        "layout": None,
        "routing_trace": {},
        "candidates": [{
            "status": "parsed",
            "importer": {"name": importer_name, "eori": importer_eori},
            "invoice": {
                "invoice_number": invoice_number,
                "invoice_date": "2025-01-15",
                "origin_country": origin_country,
                "incoterm": "FOB",
                "entry_reference": "ER-001",
            },
            "lines": lines,
            "emissions": emissions,
            "evidence": [],
        }],
    }


class TestEndpointResponseShape:
    """The 201 response is always the stub — background task state is in conn."""

    def test_returns_201_with_case_id_and_sha256(self, monkeypatch):
        client, _ = _client_with_fake_engine()
        monkeypatch.setattr(
            cbam_api, "ingest_orchestrator",
            _FakeOrchestrator(_make_ingest_plan()),
        )

        resp = client.post(
            "/api/cbam/drafts/from-document",
            files={"file": ("invoice.txt", _upload_bytes(), "text/plain")},
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["created"]["case_id"] is not None
        assert body["document_sha256"] is not None
        assert len(body["document_sha256"]) == 64  # SHA-256 hex

    def test_stub_response_has_empty_arrays(self, monkeypatch):
        client, _ = _client_with_fake_engine()
        monkeypatch.setattr(
            cbam_api, "ingest_orchestrator",
            _FakeOrchestrator(_make_ingest_plan()),
        )

        resp = client.post(
            "/api/cbam/drafts/from-document",
            files={"file": ("invoice.txt", _upload_bytes(), "text/plain")},
        )

        assert resp.status_code == 201
        created = resp.json()["created"]
        # Stub always has empty arrays — real IDs are in the DB after background task
        assert created["goods_line_ids"] == []
        assert created["emissions_ids"] == []
        assert created["shipment_id"] is None

    def test_no_parsed_or_extraction_validation_in_response(self, monkeypatch):
        client, _ = _client_with_fake_engine()
        monkeypatch.setattr(
            cbam_api, "ingest_orchestrator",
            _FakeOrchestrator(_make_ingest_plan()),
        )

        resp = client.post(
            "/api/cbam/drafts/from-document",
            files={"file": ("invoice.txt", _upload_bytes(), "text/plain")},
        )

        body = resp.json()
        assert "parsed" not in body
        assert "extraction_validation" not in body

    def test_document_sha256_matches_uploaded_bytes(self, monkeypatch):
        import hashlib
        client, _ = _client_with_fake_engine()
        monkeypatch.setattr(
            cbam_api, "ingest_orchestrator",
            _FakeOrchestrator(_make_ingest_plan()),
        )
        file_bytes = _upload_bytes()
        expected_sha256 = hashlib.sha256(file_bytes).hexdigest()

        resp = client.post(
            "/api/cbam/drafts/from-document",
            files={"file": ("invoice.txt", file_bytes, "text/plain")},
        )

        assert resp.json()["document_sha256"] == expected_sha256


class TestPipelineHappyPath:
    """After the request, the background task should have written to the fake DB."""

    def test_goods_line_and_emissions_created(self, monkeypatch):
        client, conn = _client_with_fake_engine()
        monkeypatch.setattr(
            cbam_api, "ingest_orchestrator",
            _FakeOrchestrator(_make_ingest_plan()),
        )

        resp = client.post(
            "/api/cbam/drafts/from-document",
            files={"file": ("invoice.txt", _upload_bytes(), "text/plain")},
        )

        assert resp.status_code == 201
        assert len(conn.goods_lines) == 1
        assert len(conn.emissions) == 1

    def test_goods_line_has_correct_cn_code(self, monkeypatch):
        client, conn = _client_with_fake_engine()
        monkeypatch.setattr(
            cbam_api, "ingest_orchestrator",
            _FakeOrchestrator(_make_ingest_plan(cn_code="720711")),
        )

        client.post(
            "/api/cbam/drafts/from-document",
            files={"file": ("invoice.txt", _upload_bytes(), "text/plain")},
        )

        goods_line = next(iter(conn.goods_lines.values()))
        assert goods_line["cn_code"] == "720711"

    def test_case_created_with_importer_eori(self, monkeypatch):
        client, conn = _client_with_fake_engine()
        plan = _make_ingest_plan(importer_eori="GB999888777")
        monkeypatch.setattr(cbam_api, "ingest_orchestrator", _FakeOrchestrator(plan))

        resp = client.post(
            "/api/cbam/drafts/from-document",
            files={"file": ("invoice.txt", _upload_bytes(), "text/plain")},
        )

        case_id = resp.json()["created"]["case_id"]
        # The stub case is created, then updated by the pipeline to the real eori
        case = conn.cases.get(case_id)
        assert case is not None
        assert case["importer_eori"] == "GB999888777"

    def test_without_emissions_selector_still_creates_emission_record(self, monkeypatch):
        """Annex VI default always fires when supplier provides no emissions data."""
        client, conn = _client_with_fake_engine()
        plan = _make_ingest_plan(has_emissions=False)
        monkeypatch.setattr(cbam_api, "ingest_orchestrator", _FakeOrchestrator(plan))

        client.post(
            "/api/cbam/drafts/from-document",
            files={"file": ("invoice.txt", _upload_bytes(), "text/plain")},
        )

        assert len(conn.emissions) >= 1


class TestPipelineEdgeCases:

    def test_numeric_string_quantities_are_coerced(self, monkeypatch):
        client, conn = _client_with_fake_engine()
        plan = _make_ingest_plan(mass="10000.0", direct="50000.0", indirect="10000.0")
        monkeypatch.setattr(cbam_api, "ingest_orchestrator", _FakeOrchestrator(plan))

        client.post(
            "/api/cbam/drafts/from-document",
            files={"file": ("invoice.txt", _upload_bytes(), "text/plain")},
        )

        assert len(conn.goods_lines) == 1
        gl = next(iter(conn.goods_lines.values()))
        assert isinstance(gl.get("quantity"), float)

    def test_invalid_numeric_marks_case_as_error(self, monkeypatch):
        client, conn = _client_with_fake_engine()
        plan = _make_ingest_plan(mass="ten thousand")  # non-numeric → coerce fails
        monkeypatch.setattr(cbam_api, "ingest_orchestrator", _FakeOrchestrator(plan))

        resp = client.post(
            "/api/cbam/drafts/from-document",
            files={"file": ("invoice.txt", _upload_bytes(), "text/plain")},
        )

        assert resp.status_code == 201  # stub is always 201
        case_id = resp.json()["created"]["case_id"]
        case = conn.cases.get(case_id)
        assert case is not None
        assert case.get("status") == "error"
        assert len(conn.goods_lines) == 0

    def test_no_candidates_marks_case_as_error(self, monkeypatch):
        client, conn = _client_with_fake_engine()
        monkeypatch.setattr(
            cbam_api, "ingest_orchestrator",
            _FakeOrchestrator({"raw_text": "", "layout": None, "routing_trace": {}, "candidates": []}),
        )

        resp = client.post(
            "/api/cbam/drafts/from-document",
            files={"file": ("invoice.txt", _upload_bytes(), "text/plain")},
        )

        assert resp.status_code == 201
        case_id = resp.json()["created"]["case_id"]
        assert conn.cases[case_id].get("status") == "error"


class TestPipelineMultiline:

    def test_two_line_items_create_two_goods_lines_and_emissions(self, monkeypatch):
        client, conn = _client_with_fake_engine()
        plan = _make_ingest_plan(
            invoice_number="INV-MULTI-001",
            cn_code="720711",
            mass=10000,
            direct=50000,
            indirect=10000,
            extra_lines=[{
                "cn_code": "730890",
                "description": "Structural steel section",
                "quantity": 5000,
                "quantity_unit": "kg",
                "net_mass_kg": 5000,
                "direct_embedded_kgco2e": 25000,
                "indirect_embedded_kgco2e": 5000,
            }],
        )
        monkeypatch.setattr(cbam_api, "ingest_orchestrator", _FakeOrchestrator(plan))

        resp = client.post(
            "/api/cbam/drafts/from-document",
            files={"file": ("multiline.txt", _upload_multiline_bytes(), "text/plain")},
        )

        assert resp.status_code == 201
        assert len(conn.goods_lines) == 2
        assert len(conn.emissions) == 2
        cn_codes = {gl["cn_code"] for gl in conn.goods_lines.values()}
        assert cn_codes == {"720711", "730890"}


class TestPipelineDuplicateHandling:

    def test_two_uploads_each_create_independent_case_and_shipment(self, monkeypatch):
        """Each async upload creates its own stub case; shipment reuse is per-case."""
        client, conn = _client_with_fake_engine()
        plan_a = _make_ingest_plan(invoice_number="INV-A-001", importer_eori="GB111111111")
        plan_b = _make_ingest_plan(invoice_number="INV-B-001", importer_eori="GB222222222")

        monkeypatch.setattr(cbam_api, "ingest_orchestrator", _FakeOrchestrator(plan_a))
        resp_a = client.post(
            "/api/cbam/drafts/from-document",
            files={"file": ("a.txt", _upload_bytes(), "text/plain")},
        )
        monkeypatch.setattr(cbam_api, "ingest_orchestrator", _FakeOrchestrator(plan_b))
        resp_b = client.post(
            "/api/cbam/drafts/from-document",
            files={"file": ("b.txt", _upload_bytes(), "text/plain")},
        )

        assert resp_a.status_code == 201
        assert resp_b.status_code == 201
        assert resp_a.json()["created"]["case_id"] != resp_b.json()["created"]["case_id"]
        assert len(conn.goods_lines) == 2
        assert len(conn.emissions) == 2


class TestFormOverrides:

    def test_form_importer_eori_overrides_extracted_eori(self, monkeypatch):
        client, conn = _client_with_fake_engine()
        plan = _make_ingest_plan(importer_eori="GB000000000")
        monkeypatch.setattr(cbam_api, "ingest_orchestrator", _FakeOrchestrator(plan))

        resp = client.post(
            "/api/cbam/drafts/from-document",
            files={"file": ("invoice.txt", _upload_bytes(), "text/plain")},
            data={"importer_eori": "GBFORM123456"},
        )

        assert resp.status_code == 201
        case_id = resp.json()["created"]["case_id"]
        assert conn.cases[case_id]["importer_eori"] == "GBFORM123456"
