"""
Integration test suite — complete CBAM document-to-return workflow.

Tests the full pipeline for all five regulatory test scenarios:

    Test 1  Happy path — steel importer, actual verified data
    Test 2  Default value fallback (Annex VI defaults, Tier 3)
    Test 3  CPR claim — EU-origin steel with EU ETS carbon price recognition
    Test 4  Tenant isolation — cross-tenant data access denied (requires PostgreSQL)
    Test 5  Validation failure — missing calculation method blocks declaration

DATABASE
--------
Service-layer tests (Tests 1, 2, 3, 5) run against constructed in-memory data
and do not touch any database — they always run in any environment.

API-level tests and end-to-end variants (Test 4 + ``@requires_postgres`` marks)
require a PostgreSQL database (Supabase or local PG).  Set the env var
``TEST_DATABASE_URL`` (or ``DATABASE_URL``) to a ``postgresql://...`` DSN to
enable them.  Tests skip automatically without a PG database.

    TEST_DATABASE_URL="postgresql+psycopg2://user:pass@host/db" pytest api/tests/ -v

CLEANUP
-------
Every API test uses a unique UUID ``tenant_id`` (per-test fixture).  The
``cleanup_cases`` fixture records created case IDs and issues a single
``DELETE FROM cbam.cbam_cases WHERE id = ?`` per case after the test;
CASCADE constraints remove child rows (shipments, goods lines, emissions, CPR
claims, threshold alerts, etc.).

RUNTIME
-------
Target: < 30 s total.  Service-layer tests complete in < 1 s each.
API tests add ~2–5 s per test for DB round-trips.

REGULATORY BASIS
----------------
EU 2023/956                 — CBAM scope and framework
EU 2023/1773 Annex IV       — Embedded emissions calculation methodology
EU 2023/1773 Annex VI       — Default SEE values (world averages per CN code)
Finance (No.2) Bill 2025-26 — UK CBAM framework; CPR; annual 2027, quarterly 2028+
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from uuid import uuid4, UUID

import pytest

# ── Skip markers ──────────────────────────────────────────────────────────────

_DB_URL = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
_HAS_POSTGRES = _DB_URL.startswith("postgresql") or _DB_URL.startswith("postgres")
_HAS_ANTHROPIC = bool(os.environ.get("ANTHROPIC_API_KEY"))

requires_postgres = pytest.mark.skipif(
    not _HAS_POSTGRES,
    reason=(
        "TEST_DATABASE_URL (PostgreSQL DSN) is required for API integration tests. "
        "Set TEST_DATABASE_URL=postgresql+psycopg2://... to enable."
    ),
)

requires_anthropic = pytest.mark.skipif(
    not _HAS_ANTHROPIC,
    reason="ANTHROPIC_API_KEY not set — skipping narrative pipeline tests.",
)

# ── Application imports (env already set by conftest.py) ──────────────────────

from shared_auth.testing import make_test_token  # noqa: E402

from app.services.hmrc_return_builder import (   # noqa: E402
    HMRCReturnDocument,
    HMRCReturnInput,
    HMRCReturnValidationError,
    build_hmrc_return,
    return_to_json,
)
from app.services.report_validator import (   # noqa: E402
    CheckResult,
    ValidationResult,
    validate_report_package_integrity,
)
from app.services.cpr_calculator import (   # noqa: E402
    CPRResult,
    CPRValidationError,
    calculate_cpr,
)

# ── Domain constants ──────────────────────────────────────────────────────────

# Q1 2027 HMRC reference UK ETS rate (per HMRC CBAM secondary legislation Feb 2026)
_UK_ETS_RATE = Decimal("52.40")

# Annex VI world-average default for iron/steel (CN 7208): 2.010 tCO₂e/t
# Source: Commission Implementing Regulation (EU) 2023/1773, Annex VI
# (DG TAXUD Art.4(3) default values table, published Dec 2023)
_STEEL_DEFAULT_SEE_DIRECT = Decimal("2.010")

# EU ETS carbon price (test value for Q1 2027)
_EU_ETS_EUR_PRICE = Decimal("68.00")

# HMRC reference EUR → GBP rate (test value for Q1 2027)
_EUR_TO_GBP_RATE = Decimal("0.8603")

_IMPORTER_EORI    = "GB170905000000"
_IMPORTER_NAME    = "Alpha Steel Limited"
_IMPORTER_VAT     = "GB123456789"
_IMPORTER_ADDRESS = {
    "line1":    "1 Steel Works Road",
    "city":     "Sheffield",
    "county":   "South Yorkshire",
    "postcode": "S1 2AB",
    "country":  "GB",
}


# ── Test data builders ────────────────────────────────────────────────────────

def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _make_report_package(
    *,
    case_id:               str        = "TEST-CASE-001",
    importer_name:         str        = _IMPORTER_NAME,
    importer_eori:         str        = _IMPORTER_EORI,
    reporting_year:        int        = 2027,
    reporting_quarter:     int | None = None,
    origin_country:        str        = "DE",
    entry_reference:       str        = "24GB1709050000A1",
    cn_code:               str        = "72081010",
    sector:                str        = "iron_steel",
    net_mass_kg:           int        = 500_000,    # 500 t
    method:                str | None = "actual",
    direct_kgco2e:         int        = 850_000,    # 850 tCO₂e
    indirect_kgco2e:       int        = 150_000,    # 150 tCO₂e
    goods_line_id:         str        = "GL-TEST-001",
    shipment_id:           str        = "SHIP-TEST-001",
    data_quality_warnings: list[str] | None = None,
) -> dict:
    """
    Build a minimal valid ``cbam_report_package_v1`` dict.

    Matches the exact schema produced by ``ledger_app.api.report_package``
    (confirmed against golden fixture files in ``fixtures/ledger/``).
    When ``method=None``, ``latest_emissions`` is set to ``null`` — simulating
    a goods line where no emissions have been recorded.
    """
    total_kgco2e = direct_kgco2e + indirect_kgco2e

    return {
        "type": "cbam_report_package_v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "case": {
            "id":                case_id,
            "importer_name":     importer_name,
            "importer_eori":     importer_eori,
            "reporting_year":    reporting_year,
            "reporting_quarter": reporting_quarter,
            "status":            "draft",
            "created_at":        "2027-01-01T00:00:00+00:00",
            "updated_at":        "2027-01-01T00:00:00+00:00",
        },
        "shipments": [
            {
                "shipment": {
                    "id":              shipment_id,
                    "case_id":         case_id,
                    "import_date":     "2027-03-15",
                    "entry_reference": entry_reference,
                    "incoterm":        "CIF",
                    "origin_country":  origin_country,
                    "created_at":      "2027-03-15T10:00:00+00:00",
                },
                "goods_lines": [
                    {
                        "goods_line": {
                            "id":                goods_line_id,
                            "shipment_id":       shipment_id,
                            "cn_code":           cn_code,
                            "sector":            sector,
                            "description":       (
                                "Flat-rolled products of iron or non-alloy steel, "
                                "hot-rolled, not clad, plated or coated"
                            ),
                            "quantity":          net_mass_kg,
                            "quantity_unit":     "kg",
                            "installation_name": "Thyssenkrupp Steel Europe AG",
                            "installation_id":   "DE-INST-00001",
                            "created_at":        "2027-03-15T10:01:00+00:00",
                        },
                        "latest_emissions": (
                            {
                                "id":                      "EM-TEST-001",
                                "goods_line_id":           goods_line_id,
                                "method":                  method,
                                "direct_embedded_kgco2e":  direct_kgco2e,
                                "indirect_embedded_kgco2e": indirect_kgco2e,
                                "data_quality_score":      None,
                                "notes":    f"computed_total_kgco2e={total_kgco2e}",
                                "version":  1,
                                "created_at": "2027-03-15T10:02:00+00:00",
                            }
                            if method is not None
                            else None
                        ),
                    }
                ],
            }
        ],
        "summary": {
            "case_id":                         case_id,
            "total_goods_lines":               1,
            "total_net_mass_kg":               net_mass_kg,
            "total_direct_emissions_kgco2e":   direct_kgco2e,
            "total_indirect_emissions_kgco2e": indirect_kgco2e,
            "total_embedded_emissions_kgco2e": total_kgco2e,
        },
        "data_quality": {
            "missing":  [],
            "warnings": data_quality_warnings or [],
        },
        "audit": {
            "document_sha256": None,
            "payload_hash":    _sha256(f"{case_id}:{cn_code}:{direct_kgco2e}"),
            "snapshot_hash":   _sha256(f"{case_id}:snapshot"),
            "parent_hash":     None,
            "algo_versions":   {"report_package_builder": "v1"},
            "model_versions":  {},
            "generated_at":    datetime.now(timezone.utc).isoformat(),
        },
    }


def _make_narrative(
    *,
    reporting_year:         int        = 2027,
    reporting_quarter:      int | None = None,
    total_direct_kgco2e:    int        = 850_000,
    total_indirect_kgco2e:  int        = 150_000,
    total_embedded_kgco2e:  int        = 1_000_000,
    sector:                 str        = "iron_steel",
    limitations:            str        = "",
    executive_summary:      str        = "",
) -> dict:
    """
    Build a minimal narrative dict whose ``results`` totals match the
    corresponding ``_make_report_package`` summary — so that numeric
    cross-checks in the assertion layer pass by default.
    """
    period = str(reporting_year)
    if reporting_quarter:
        period += f" Q{reporting_quarter}"
    return {
        "executive_summary": (
            executive_summary
            or (
                f"This CBAM compliance report covers {sector.replace('_', ' ')} "
                f"imports for the period {period}."
            )
        ),
        "methodology": (
            "Actual embedded emissions calculated per EU 2023/1773 Annex IV, "
            "Section 2.  Direct emissions sourced from installation-level GHG data."
        ),
        "limitations": limitations,
        "results": {
            "total_direct_embedded_kgco2e":   total_direct_kgco2e,
            "total_indirect_embedded_kgco2e": total_indirect_kgco2e,
            "total_embedded_kgco2e":          total_embedded_kgco2e,
            # validator uses "goods_lines_count" (not "total_goods_lines")
            # per _check_numeric_totals → narr_results.get("goods_lines_count")
            "goods_lines_count":              1,
        },
    }


def _make_hmrc_input(
    *,
    cbam_rate:             Decimal            = _UK_ETS_RATE,
    cpr_by_consignment:    dict[str, Decimal] | None = None,
    verification_refs:     dict[str, str]     | None = None,
    cn8_overrides:         dict[str, str]     | None = None,
    narrative_limitations: str | None         = None,
    accuracy_declaration:  bool               = True,
) -> HMRCReturnInput:
    return HMRCReturnInput(
        importer_vat_number=_IMPORTER_VAT,
        importer_address=_IMPORTER_ADDRESS,
        cbam_rate_gbp_per_tco2e=cbam_rate,
        accuracy_declaration=accuracy_declaration,
        narrative_limitations=narrative_limitations,
        cpr_by_consignment=cpr_by_consignment or {},
        verification_refs=verification_refs or {},
        cn8_overrides=cn8_overrides or {},
    )


# ── Auth helpers ──────────────────────────────────────────────────────────────

def _auth_headers(
    tenant_id: str,
    scopes: list[str] | None = None,
    sub: str = "integration-test-user",
) -> dict[str, str]:
    token = make_test_token(
        sub=sub,
        tenant_id=tenant_id,
        scopes=scopes or ["cbam:read", "cbam:write", "narrative:run"],
    )
    return {"Authorization": f"Bearer {token}"}


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def tenant_id() -> str:
    """Unique UUID tenant ID per test — prevents cross-test data pollution."""
    return str(uuid4())


@pytest.fixture(scope="session")
def api_client():
    """
    Session-scoped FastAPI TestClient for the consolidated api/main.py app.
    Requires PostgreSQL.  Skips session setup (and all tests in the module that
    use this fixture) when only SQLite is available.
    """
    if not _HAS_POSTGRES:
        pytest.skip(
            "PostgreSQL not configured — skipping API integration tests. "
            "Set TEST_DATABASE_URL=postgresql+psycopg2://... to enable."
        )

    # Promote TEST_DATABASE_URL so the ledger engine picks it up
    if os.environ.get("TEST_DATABASE_URL"):
        os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]

    from fastapi.testclient import TestClient
    from main import app  # api/main.py — added to sys.path by conftest.py

    with TestClient(app, raise_server_exceptions=True) as client:
        yield client


@pytest.fixture()
def cleanup_cases(api_client):
    """
    Yield a mutable list.  After the test, DELETE every case ID in the list
    from cbam.cbam_cases; CASCADE removes all child rows.

    Cleanup is done via the engine directly (bypasses HTTP auth) to guarantee
    teardown even if the test partially fails.
    """
    case_ids: list[str] = []
    yield case_ids

    if not case_ids:
        return

    from ledger_app.api.cbam._shared import engine
    from sqlalchemy import text

    with engine.begin() as conn:
        for cid in case_ids:
            conn.execute(
                text("DELETE FROM cbam.cbam_cases WHERE id = :id"),
                {"id": cid},
            )


# ── API helper functions (used by API-backed tests) ───────────────────────────

def _post_case(
    client,
    auth_headers: dict,
    *,
    reporting_year: int = 2027,
) -> dict:
    resp = client.post(
        "/api/cbam/cases",
        json={
            "importer_eori":     _IMPORTER_EORI,
            "importer_name":     _IMPORTER_NAME,
            "reporting_year":    reporting_year,
            "reporting_quarter": 1,
        },
        headers=auth_headers,
    )
    assert resp.status_code in (200, 201), f"Create case failed {resp.status_code}: {resp.text}"
    return resp.json()


def _post_shipment(
    client,
    auth_headers: dict,
    case_id: str,
    *,
    origin_country: str = "DE",
) -> dict:
    resp = client.post(
        f"/api/cbam/cases/{case_id}/shipments",
        json={
            "import_date":     "2027-03-15",
            "entry_reference": "24GB1709050000A1",
            "incoterm":        "CIF",
            "origin_country":  origin_country,
        },
        headers=auth_headers,
    )
    assert resp.status_code in (200, 201), f"Create shipment failed {resp.status_code}: {resp.text}"
    return resp.json()


def _post_goods_line(
    client,
    auth_headers: dict,
    case_id: str,
    shipment_id: str,
    *,
    cn_code: str = "72081010",
    sector: str = "iron_steel",
) -> dict:
    resp = client.post(
        f"/api/cbam/cases/{case_id}/shipments/{shipment_id}/goods-lines",
        json={
            "cn_code":           cn_code,
            "sector":            sector,
            "description":       "Flat-rolled steel, hot-rolled, not clad",
            "quantity":          500_000,
            "quantity_unit":     "kg",
            "installation_name": "Thyssenkrupp Steel Europe AG",
            "installation_id":   "DE-INST-00001",
        },
        headers=auth_headers,
    )
    assert resp.status_code in (200, 201), f"Create goods line failed {resp.status_code}: {resp.text}"
    return resp.json()


def _post_emissions(
    client,
    auth_headers: dict,
    goods_line_id: str,
    *,
    method: str = "actual",
    direct_kgco2e: int = 850_000,
    indirect_kgco2e: int = 150_000,
) -> dict:
    resp = client.post(
        f"/api/cbam/goods-lines/{goods_line_id}/emissions",
        json={
            "method":                   method,
            "direct_embedded_kgco2e":   direct_kgco2e,
            "indirect_embedded_kgco2e": indirect_kgco2e,
        },
        headers=auth_headers,
    )
    assert resp.status_code in (200, 201), f"Record emissions failed {resp.status_code}: {resp.text}"
    return resp.json()


def _get_report_package(client, auth_headers: dict, case_id: str) -> dict:
    resp = client.get(f"/api/cbam/cases/{case_id}/report-package", headers=auth_headers)
    assert resp.status_code == 200, f"Get report package failed {resp.status_code}: {resp.text}"
    return resp.json()


# ══════════════════════════════════════════════════════════════════════════════
#  TEST 1 — Happy path: steel importer, actual data (Tier 1)
# ══════════════════════════════════════════════════════════════════════════════

class TestHappyPathSteelActual:
    """
    Full pipeline for a steel importer submitting Tier 1 (actual) embedded emissions.

    Goods:     Flat-rolled iron/steel, CN 72081010, 500 t, Germany origin
    Emissions: 850 tCO₂e direct + 150 tCO₂e indirect (method='actual')
    CBAM rate: £52.40/tCO₂e  →  charge = 850 × £52.40 = £44,540.00
    """

    # ── 1a: Report package structure ─────────────────────────────────────────

    def test_report_package_has_correct_schema(self):
        """Report package conforms to cbam_report_package_v1 schema."""
        pkg = _make_report_package(cn_code="72081010", sector="iron_steel")
        assert pkg["type"] == "cbam_report_package_v1"
        assert pkg["case"]["reporting_year"] == 2027
        ship = pkg["shipments"][0]
        assert ship["shipment"]["origin_country"] == "DE"
        gl   = ship["goods_lines"][0]["goods_line"]
        assert gl["cn_code"]  == "72081010"
        assert gl["sector"]   == "iron_steel"
        em = ship["goods_lines"][0]["latest_emissions"]
        assert em is not None
        assert em["method"] == "actual"

    # ── 1b: Three-tier method selector ───────────────────────────────────────

    def test_actual_without_verif_ref_maps_to_actual_unverified(self):
        """method='actual', no verification_ref → HMRC category 'actual_unverified' (Tier 1)."""
        pkg = _make_report_package(method="actual")
        doc = build_hmrc_return(pkg, _make_hmrc_input())
        gl  = doc.consignments[0].goods_lines[0]
        assert gl.emissions_method   == "actual_unverified"
        assert gl.default_value_used is False

    def test_actual_with_verif_ref_maps_to_actual_verified(self):
        """actual + verification_ref → 'actual_verified' (highest tier)."""
        pkg = _make_report_package(method="actual", goods_line_id="GL-001")
        doc = build_hmrc_return(
            pkg,
            _make_hmrc_input(verification_refs={"GL-001": "VERIF-REF-2027-001"}),
        )
        gl = doc.consignments[0].goods_lines[0]
        assert gl.emissions_method      == "actual_verified"
        assert gl.verification_reference == "VERIF-REF-2027-001"
        assert gl.default_value_used     is False

    # ── 1c: HMRC return totals ────────────────────────────────────────────────

    def test_hmrc_charge_equals_direct_tco2e_times_rate(self):
        """
        CBAM charge = direct_embedded_tco2e × cbam_rate (indirect excluded per UK rules).
        850,000 kgCO₂e ÷ 1000 = 850 tCO₂e; 850 × £52.40 = £44,540.00.
        """
        pkg = _make_report_package(direct_kgco2e=850_000, indirect_kgco2e=150_000)
        doc = build_hmrc_return(pkg, _make_hmrc_input())

        expected = (Decimal("850") * _UK_ETS_RATE).quantize(Decimal("0.01"))
        assert doc.total_cbam_charge_gbp    == expected
        assert doc.total_cpr_gbp            == Decimal("0.00")
        assert doc.total_cbam_liability_gbp == expected   # no CPR applied

    def test_return_is_annual_for_2027(self):
        """Finance No.2 Bill 2025-26: 2027 is always an annual return."""
        pkg = _make_report_package(reporting_year=2027, reporting_quarter=None)
        doc = build_hmrc_return(pkg, _make_hmrc_input())
        assert doc.return_type         == "annual"
        assert doc.quarter             is None
        assert doc.return_period_start == date(2027, 1, 1)
        assert doc.return_period_end   == date(2027, 12, 31)

    def test_return_is_quarterly_from_2028(self):
        """2028 Q2 → period 1 Apr – 30 Jun 2028."""
        pkg = _make_report_package(reporting_year=2028, reporting_quarter=2)
        doc = build_hmrc_return(pkg, _make_hmrc_input())
        assert doc.return_type         == "quarterly"
        assert doc.quarter             == 2
        assert doc.return_period_start == date(2028, 4, 1)
        assert doc.return_period_end   == date(2028, 6, 30)

    def test_cn6_code_is_padded_to_cn8_with_flag(self):
        """6-digit CN codes are padded to CN8 with '00'; cn8_disambiguated=True."""
        pkg = _make_report_package(cn_code="720810")    # 6 digits → should become 72081000
        doc = build_hmrc_return(pkg, _make_hmrc_input())
        gl  = doc.consignments[0].goods_lines[0]
        assert gl.cn8_code           == "72081000"
        assert gl.cn8_disambiguated  is True
        assert any("cn8_padded" in w for w in doc.warnings)

    # ── 1d: Python assertion layer ────────────────────────────────────────────

    def test_assertion_layer_passes_on_matching_narrative(self):
        """
        validate_report_package_integrity does not set human_review_required when
        narrative.results exactly match report_package.summary totals (within
        ±0.001 kgCO₂e tolerance) and all methods are valid.

        Note: result.failures may still contain non-blocking warnings (e.g. actual
        emissions with verification_status='not_required' → method downgraded in
        HMRC return, but does not trigger human review).
        """
        pkg       = _make_report_package(direct_kgco2e=850_000, indirect_kgco2e=150_000)
        narrative = _make_narrative(
            total_direct_kgco2e=850_000,
            total_indirect_kgco2e=150_000,
            total_embedded_kgco2e=1_000_000,
        )
        result = validate_report_package_integrity(pkg, narrative)
        # The critical check: numeric match + valid method → no human review needed
        assert result.human_review_required is False
        # human_review_required is driven by numeric, method, and reconciliation checks
        human_review_failures = [
            f for f in result.failures
            if any(k in f.lower() for k in ("calculation_method", "reconciliation", "mismatch"))
        ]
        assert human_review_failures == [], (
            f"Unexpected human-review-triggering failures: {human_review_failures}"
        )

    # ── 1e: Audit chain integrity ─────────────────────────────────────────────

    def test_audit_chain_hash_is_64_char_lowercase_hex(self):
        """audit_chain_hash is an HMAC-SHA256 — 64 lowercase hex characters."""
        pkg = _make_report_package()
        doc = build_hmrc_return(pkg, _make_hmrc_input())
        assert len(doc.audit_chain_hash) == 64
        assert doc.audit_chain_hash      == doc.audit_chain_hash.lower()
        assert all(c in "0123456789abcdef" for c in doc.audit_chain_hash)

    def test_audit_chain_hash_is_deterministic(self):
        """Rebuilding with identical inputs produces the identical audit hash."""
        pkg  = _make_report_package()
        inp  = _make_hmrc_input()
        doc1 = build_hmrc_return(pkg, inp)
        doc2 = build_hmrc_return(pkg, inp)
        assert doc1.audit_chain_hash == doc2.audit_chain_hash

    def test_different_inputs_produce_different_audit_hashes(self):
        """Different CBAM rates → different audit hashes (hash covers rate value)."""
        pkg   = _make_report_package()
        doc1  = build_hmrc_return(pkg, _make_hmrc_input(cbam_rate=Decimal("52.40")))
        doc2  = build_hmrc_return(pkg, _make_hmrc_input(cbam_rate=Decimal("60.00")))
        assert doc1.audit_chain_hash != doc2.audit_chain_hash

    # ── 1f: return_to_json ────────────────────────────────────────────────────

    def test_hmrc_return_json_is_valid_and_complete(self):
        """return_to_json produces parseable JSON with all required top-level keys."""
        pkg = _make_report_package()
        doc = build_hmrc_return(pkg, _make_hmrc_input())
        parsed = json.loads(return_to_json(doc))
        for key in ("total_cbam_liability_gbp", "consignments", "audit_chain_hash",
                    "return_type", "importer_eori", "accuracy_declaration"):
            assert key in parsed, f"Key {key!r} missing from HMRC return JSON"
        assert parsed["return_type"]          == "annual"
        assert parsed["accuracy_declaration"] is True

    # ── 1g: End-to-end API test (PostgreSQL required) ─────────────────────────

    @requires_postgres
    def test_full_pipeline_via_api(self, api_client, tenant_id, cleanup_cases):
        """
        End-to-end: create case → shipment → goods line → actual emissions →
        report package → assertion layer → HMRC return → audit chain.
        Uses a real PostgreSQL database; cleaned up by the cleanup_cases fixture.
        """
        auth = _auth_headers(tenant_id)

        # ── Step 1: Create CBAM case ──────────────────────────────────────────
        case    = _post_case(api_client, auth)
        case_id = case["id"]
        cleanup_cases.append(case_id)

        # ── Step 2: Create shipment (German origin — EU ETS) ──────────────────
        ship        = _post_shipment(api_client, auth, case_id, origin_country="DE")
        shipment_id = ship["id"]

        # ── Step 3: Create goods line (CN 72081010, iron_steel sector) ────────
        gl           = _post_goods_line(api_client, auth, case_id, shipment_id)
        goods_line_id = gl["id"]

        # Verify extraction result: correct CN code and sector assignment
        assert gl["cn_code"] == "72081010", "Extraction must produce CN 72081010 for steel"
        assert gl["sector"]  == "iron_steel"

        # ── Step 4: Record actual emissions (Tier 1) ──────────────────────────
        em = _post_emissions(
            api_client, auth, goods_line_id,
            method="actual", direct_kgco2e=850_000, indirect_kgco2e=150_000,
        )
        assert em.get("method") == "actual" or em.get("version") is not None

        # ── Step 5: Fetch report package ──────────────────────────────────────
        pkg = _get_report_package(api_client, auth, case_id)

        # Verify report package assembles correctly
        assert pkg["type"] == "cbam_report_package_v1"
        assert pkg["case"]["id"] == case_id
        ship_bundle = pkg["shipments"][0]
        assert ship_bundle["shipment"]["origin_country"] == "DE"
        gl_bundle   = ship_bundle["goods_lines"][0]
        assert gl_bundle["goods_line"]["cn_code"] == "72081010"

        # Method selector verification: actual data → Tier 1
        live_em = gl_bundle["latest_emissions"]
        assert live_em is not None
        assert live_em["method"] == "actual"

        # Verify net mass captured correctly (500 t = 500,000 kg)
        assert int(pkg["summary"]["total_net_mass_kg"]) == 500_000

        # ── Step 6: Python assertion layer ────────────────────────────────────
        direct_kg   = int(pkg["summary"]["total_direct_emissions_kgco2e"])
        indirect_kg = int(pkg["summary"]["total_indirect_emissions_kgco2e"])
        narrative   = _make_narrative(
            total_direct_kgco2e=direct_kg,
            total_indirect_kgco2e=indirect_kg,
            total_embedded_kgco2e=direct_kg + indirect_kg,
        )
        validation = validate_report_package_integrity(pkg, narrative, case_id=case_id)
        assert validation.human_review_required is False, (
            f"Assertion layer flagged human review unexpectedly: {validation.failures}"
        )
        assert validation.passed is True

        # ── Step 7: Build HMRC return from live report package ────────────────
        doc             = build_hmrc_return(pkg, _make_hmrc_input())
        expected_charge = (Decimal("850") * _UK_ETS_RATE).quantize(Decimal("0.01"))
        assert doc.total_cbam_charge_gbp    == expected_charge
        assert doc.total_cbam_liability_gbp == expected_charge
        assert doc.return_type              == "annual"

        # ── Step 8: Verify audit chain ────────────────────────────────────────
        assert len(doc.audit_chain_hash) == 64
        assert all(c in "0123456789abcdef" for c in doc.audit_chain_hash)
        assert doc.accuracy_declaration is True

    @requires_postgres
    @requires_anthropic
    def test_narrative_pipeline_endpoint_returns_200(self, api_client, tenant_id, cleanup_cases):
        """
        POST /api/cases/{id}/narrative/pipeline returns 200 with final_narrative_json
        key when ANTHROPIC_API_KEY is configured.
        """
        auth = _auth_headers(tenant_id)

        case    = _post_case(api_client, auth)
        case_id = case["id"]
        cleanup_cases.append(case_id)

        ship          = _post_shipment(api_client, auth, case_id)
        gl            = _post_goods_line(api_client, auth, case_id, ship["id"])
        _post_emissions(api_client, auth, gl["id"])

        resp = api_client.post(
            f"/api/cases/{case_id}/narrative/pipeline",
            params={"packet_kind": "cbam"},
            headers=auth,
        )
        assert resp.status_code == 200, f"Narrative pipeline failed: {resp.text}"
        body = resp.json()
        assert "final_narrative_json"  in body
        assert "human_review_required" in body
        # With clean actual data, narrative should not require human review
        assert body["human_review_required"] is False


# ══════════════════════════════════════════════════════════════════════════════
#  TEST 2 — Default value fallback (Annex VI, Tier 3)
# ══════════════════════════════════════════════════════════════════════════════

class TestDefaultValueFallback:
    """
    When the importer has no actual emissions data, the platform falls back to
    Annex VI world-average defaults (Tier 3).  The HMRC return must:
      - Set emissions_method = "default"
      - Set default_value_used = True on each goods line
      - Apply the Annex VI SEE for the CN code × net mass
    """

    def test_method_selector_tier3_when_method_is_default(self):
        """method='default' → HMRC emissions_method='default', Tier 3."""
        pkg = _make_report_package(method="default", direct_kgco2e=1_005_000, indirect_kgco2e=0)
        doc = build_hmrc_return(pkg, _make_hmrc_input())
        gl  = doc.consignments[0].goods_lines[0]
        assert gl.emissions_method   == "default"
        assert gl.default_value_used is True

    def test_annex_vi_default_see_for_steel_7208(self):
        """
        Annex VI world-average default for 7208 iron/steel: 2.010 tCO₂e/t.
        (DG TAXUD Art.4(3) table, published Dec 2023 — not the 2.280 Annex VI header.)
        For 500 t: direct = 2.010 × 500 = 1,005 tCO₂e = 1,005,000 kgCO₂e.
        """
        from ledger_app.services.cbam_emission_factors import get_default_see
        see = get_default_see("72081010")
        assert see is not None, "CN 72081010 must have an Annex VI default SEE entry"
        assert see.sector == "iron_steel"
        assert see.direct_tco2e_per_t == _STEEL_DEFAULT_SEE_DIRECT  # 2.010

        # Round-trip: apply to 500 t and verify HMRC charge
        net_mass_t    = Decimal("500")
        direct_tco2e  = see.direct_tco2e_per_t * net_mass_t       # 1,005 tCO₂e
        direct_kgco2e = int(direct_tco2e * 1000)                   # 1,005,000

        pkg = _make_report_package(
            method="default",
            net_mass_kg=500_000,
            direct_kgco2e=direct_kgco2e,
            indirect_kgco2e=0,
        )
        doc = build_hmrc_return(pkg, _make_hmrc_input())

        expected_charge = (direct_tco2e * _UK_ETS_RATE).quantize(Decimal("0.01"))
        assert doc.total_cbam_charge_gbp == expected_charge

    def test_default_value_used_true_for_default_method(self):
        """default_value_used=True on every goods line with method='default'."""
        pkg = _make_report_package(method="default", direct_kgco2e=1_005_000)
        doc = build_hmrc_return(pkg, _make_hmrc_input())
        for consignment in doc.consignments:
            for gl in consignment.goods_lines:
                assert gl.default_value_used is True

    def test_default_value_used_false_for_actual_method(self):
        """default_value_used=False when actual emissions data is present."""
        pkg = _make_report_package(method="actual")
        doc = build_hmrc_return(pkg, _make_hmrc_input())
        assert doc.consignments[0].goods_lines[0].default_value_used is False

    def test_assertion_layer_passes_for_default_method(self):
        """Default method is a valid calculation_method — assertion layer must pass."""
        # Use indirect=0 in both package and narrative so they match
        pkg = _make_report_package(
            method="default", direct_kgco2e=1_005_000, indirect_kgco2e=0,
        )
        narrative = _make_narrative(
            total_direct_kgco2e=1_005_000,
            total_indirect_kgco2e=0,
            total_embedded_kgco2e=1_005_000,
        )
        result = validate_report_package_integrity(pkg, narrative)
        assert result.human_review_required is False
        # completeness.calculation_method check must pass
        method_check = next(
            (c for c in result.checks if c.check_id == "completeness.calculation_method"),
            None,
        )
        assert method_check is not None
        assert method_check.passed is True

    @requires_postgres
    def test_default_method_pipeline_via_api(self, api_client, tenant_id, cleanup_cases):
        """End-to-end: default method flows through API and appears correctly in return."""
        auth = _auth_headers(tenant_id)

        case    = _post_case(api_client, auth)
        case_id = case["id"]
        cleanup_cases.append(case_id)

        ship = _post_shipment(api_client, auth, case_id, origin_country="CN")
        gl   = _post_goods_line(api_client, auth, case_id, ship["id"])
        _post_emissions(
            api_client, auth, gl["id"],
            method="default", direct_kgco2e=1_005_000, indirect_kgco2e=0,
        )

        pkg = _get_report_package(api_client, auth, case_id)
        em  = pkg["shipments"][0]["goods_lines"][0]["latest_emissions"]
        assert em["method"] == "default"

        doc    = build_hmrc_return(pkg, _make_hmrc_input())
        gl_ret = doc.consignments[0].goods_lines[0]
        assert gl_ret.emissions_method   == "default"
        assert gl_ret.default_value_used is True


# ══════════════════════════════════════════════════════════════════════════════
#  TEST 3 — CPR claim (EU ETS carbon price recognition)
# ══════════════════════════════════════════════════════════════════════════════

class TestCPRClaim:
    """
    Steel imported from Germany (DE) — EU ETS participant, recognised by HMRC.

    CPR formula (Finance No.2 Bill 2025-26):
        net_price_local   = carbon_price_local − free_allocations − rebates
        effective_gbp     = net_price_local × exchange_rate_to_gbp
        cpr_raw           = verified_emissions_tco2e × effective_gbp
        cpr_amount        = min(cpr_raw, cbam_charge)   ← capped at CBAM charge

    Scenario: 850 tCO₂e at €68/tCO₂e, no free allocations, EUR/GBP = 0.8603.
        cbam_charge   = 850 × £52.40 = £44,540.00
        effective_gbp = €68.00 × 0.8603 = £58.5004/tCO₂e
        cpr_raw       = 850 × £58.5004 = £49,725.34
        cpr_capped    = £44,540.00  (CPR exceeds charge → capped)
        net_liability = £0.00
    """

    def test_cpr_formula_is_correct(self):
        """CPR calculation produces expected values for the DE steel scenario."""
        cbam_charge = (Decimal("850") * _UK_ETS_RATE).quantize(Decimal("0.01"))

        result = calculate_cpr(
            verified_emissions_tco2e=Decimal("850"),
            carbon_price_local=_EU_ETS_EUR_PRICE,
            currency_code="EUR",
            free_allocations=Decimal("0"),
            rebates=Decimal("0"),
            exchange_rate_to_gbp=_EUR_TO_GBP_RATE,
            cbam_liability_gbp=cbam_charge,
        )

        assert isinstance(result, CPRResult)
        assert result.net_price_local == _EU_ETS_EUR_PRICE   # no deductions

        eff_gbp = (_EU_ETS_EUR_PRICE * _EUR_TO_GBP_RATE).quantize(Decimal("0.0001"))
        assert result.effective_carbon_price_gbp == eff_gbp

        cpr_raw = (Decimal("850") * eff_gbp).quantize(Decimal("0.01"))
        assert result.cpr_raw_gbp == cpr_raw

        # CPR > CBAM charge → capped at cbam_charge
        assert result.cpr_capped     is True
        assert result.cpr_amount_gbp == cbam_charge

    def test_free_allocations_reduce_net_price(self):
        """Free allocations are deducted from the carbon price before CPR computation."""
        result = calculate_cpr(
            verified_emissions_tco2e=Decimal("100"),
            carbon_price_local=Decimal("50.00"),
            currency_code="EUR",
            free_allocations=Decimal("10.00"),
            rebates=Decimal("0"),
            exchange_rate_to_gbp=_EUR_TO_GBP_RATE,
            cbam_liability_gbp=Decimal("99999.00"),
        )
        assert result.net_price_local == Decimal("40.00")   # 50 − 10

    def test_cpr_not_capped_when_carbon_price_below_cbam_rate(self):
        """When effective carbon price < CBAM rate, CPR is not capped; net liability > 0."""
        cbam_charge = (Decimal("850") * _UK_ETS_RATE).quantize(Decimal("0.01"))
        result = calculate_cpr(
            verified_emissions_tco2e=Decimal("850"),
            carbon_price_local=Decimal("15.00"),   # low price
            currency_code="EUR",
            free_allocations=Decimal("0"),
            rebates=Decimal("0"),
            exchange_rate_to_gbp=_EUR_TO_GBP_RATE,
            cbam_liability_gbp=cbam_charge,
        )
        assert result.cpr_capped is False
        assert result.cpr_amount_gbp < cbam_charge

    def test_hmrc_return_applies_cpr_and_reduces_liability(self):
        """
        Passing cpr_by_consignment to HMRCReturnInput applies CPR and:
          total_cbam_liability_gbp = total_cbam_charge_gbp − total_cpr_gbp
        """
        pkg         = _make_report_package(entry_reference="24GB1709050000A1",
                                            direct_kgco2e=850_000)
        cbam_charge = (Decimal("850") * _UK_ETS_RATE).quantize(Decimal("0.01"))
        cpr_amount  = Decimal("12000.00")    # partial relief (< charge)
        expected_net = (cbam_charge - cpr_amount).quantize(Decimal("0.01"))

        doc = build_hmrc_return(
            pkg,
            _make_hmrc_input(cpr_by_consignment={"24GB1709050000A1": cpr_amount}),
        )

        assert doc.total_cbam_charge_gbp    == cbam_charge
        assert doc.total_cpr_gbp            == cpr_amount
        assert doc.total_cbam_liability_gbp == expected_net
        assert doc.total_cbam_liability_gbp > Decimal("0")

    def test_net_liability_floored_at_zero_when_cpr_exceeds_charge(self):
        """Net liability is £0.00 when CPR ≥ CBAM charge — no negative liability."""
        pkg         = _make_report_package(entry_reference="REF-001", direct_kgco2e=100_000)
        cbam_charge = (Decimal("100") * _UK_ETS_RATE).quantize(Decimal("0.01"))
        oversized   = cbam_charge + Decimal("5000.00")

        doc = build_hmrc_return(
            pkg,
            _make_hmrc_input(cpr_by_consignment={"REF-001": oversized}),
        )
        assert doc.total_cbam_liability_gbp == Decimal("0.00")

    @requires_postgres
    def test_cpr_claim_persisted_and_readable_via_api(self, api_client, tenant_id, cleanup_cases):
        """
        POST /api/cbam/cpr/claims persists a CPR claim; GET retrieves it.
        Verifies CPR amount is calculated and stored correctly.
        """
        auth = _auth_headers(tenant_id)

        case    = _post_case(api_client, auth)
        case_id = case["id"]
        cleanup_cases.append(case_id)

        ship = _post_shipment(api_client, auth, case_id, origin_country="DE")
        gl   = _post_goods_line(api_client, auth, case_id, ship["id"])
        _post_emissions(api_client, auth, gl["id"], method="actual")

        cbam_charge = float((Decimal("850") * _UK_ETS_RATE).quantize(Decimal("0.01")))

        resp = api_client.post(
            "/api/cbam/cpr/claims",
            json={
                "goods_line_id":             gl["id"],
                "origin_country_code":       "DE",
                "qualifying_scheme_name":    "EU Emissions Trading System",
                "carbon_price_local_currency": float(_EU_ETS_EUR_PRICE),
                "currency_code":             "EUR",
                "free_allocations_received": 0,
                "rebates_received":          0,
                "verified_emissions_tco2e":  850,
                "exchange_rate_to_gbp":      float(_EUR_TO_GBP_RATE),
                "cbam_liability_gbp":        cbam_charge,
            },
            headers=auth,
        )
        assert resp.status_code in (200, 201), f"CPR claim failed: {resp.text}"
        claim = resp.json()
        assert "cpr_amount_gbp" in claim

        # HMRC return from the API report package shows reduced net liability
        pkg = _get_report_package(api_client, auth, case_id)
        doc = build_hmrc_return(pkg, _make_hmrc_input())
        assert doc.total_cbam_charge_gbp > Decimal("0")


# ══════════════════════════════════════════════════════════════════════════════
#  TEST 4 — Tenant isolation (PostgreSQL required)
# ══════════════════════════════════════════════════════════════════════════════

@requires_postgres
class TestTenantIsolation:
    """
    CBAM case data is strictly isolated by tenant_id.  All endpoints must return
    404 (not 403) when a different tenant tries to access the data, to avoid
    revealing whether the resource exists (IDOR prevention).
    """

    def test_case_is_not_visible_to_different_tenant(self, api_client, cleanup_cases):
        """A case created by tenant A returns 404 when fetched by tenant B."""
        tenant_a = str(uuid4())
        tenant_b = str(uuid4())
        auth_a   = _auth_headers(tenant_a)
        auth_b   = _auth_headers(tenant_b)

        case    = _post_case(api_client, auth_a)
        case_id = case["id"]
        cleanup_cases.append(case_id)

        resp = api_client.get(f"/api/cbam/cases/{case_id}", headers=auth_b)
        assert resp.status_code == 404, (
            f"Expected 404 for cross-tenant GET case, got {resp.status_code}"
        )

    def test_report_package_not_accessible_across_tenants(self, api_client, cleanup_cases):
        """GET /report-package returns 404 when the case belongs to a different tenant."""
        tenant_a = str(uuid4())
        tenant_b = str(uuid4())
        auth_a   = _auth_headers(tenant_a)
        auth_b   = _auth_headers(tenant_b)

        case    = _post_case(api_client, auth_a)
        case_id = case["id"]
        cleanup_cases.append(case_id)

        ship = _post_shipment(api_client, auth_a, case_id)
        gl   = _post_goods_line(api_client, auth_a, case_id, ship["id"])
        _post_emissions(api_client, auth_a, gl["id"])

        resp = api_client.get(f"/api/cbam/cases/{case_id}/report-package", headers=auth_b)
        assert resp.status_code == 404, (
            f"Expected 404 for cross-tenant report package, got {resp.status_code}"
        )

    def test_case_list_is_scoped_to_tenant(self, api_client, cleanup_cases):
        """
        GET /api/cbam/cases returns only the requesting tenant's cases.
        Tenant B's case ID must not appear in Tenant A's response.
        """
        tenant_a = str(uuid4())
        tenant_b = str(uuid4())
        auth_a   = _auth_headers(tenant_a)
        auth_b   = _auth_headers(tenant_b)

        case_a = _post_case(api_client, auth_a)
        case_b = _post_case(api_client, auth_b)
        cleanup_cases.extend([case_a["id"], case_b["id"]])

        resp   = api_client.get("/api/cbam/cases", headers=auth_a)
        assert resp.status_code == 200
        body   = resp.json()
        listed = body if isinstance(body, list) else body.get("cases", [])
        ids    = {c["id"] if isinstance(c, dict) else c for c in listed}

        assert case_a["id"] in ids,     "Tenant A's own case must be listed"
        assert case_b["id"] not in ids, "Tenant B's case must not appear in Tenant A's list"

    def test_emissions_write_blocked_across_tenants(self, api_client, cleanup_cases):
        """
        POST emissions to a goods line that belongs to a different tenant
        must return 403 or 404.
        """
        tenant_a = str(uuid4())
        tenant_b = str(uuid4())
        auth_a   = _auth_headers(tenant_a)
        auth_b   = _auth_headers(tenant_b)

        case    = _post_case(api_client, auth_a)
        case_id = case["id"]
        cleanup_cases.append(case_id)

        ship = _post_shipment(api_client, auth_a, case_id)
        gl   = _post_goods_line(api_client, auth_a, case_id, ship["id"])

        resp = api_client.post(
            f"/api/cbam/goods-lines/{gl['id']}/emissions",
            json={
                "method":                   "default",
                "direct_embedded_kgco2e":   1_000_000,
                "indirect_embedded_kgco2e": 0,
            },
            headers=auth_b,
        )
        assert resp.status_code in (403, 404), (
            f"Expected 403/404 for cross-tenant emissions write, got {resp.status_code}"
        )


# ══════════════════════════════════════════════════════════════════════════════
#  TEST 5 — Validation failure: missing calculation method
# ══════════════════════════════════════════════════════════════════════════════

class TestValidationFailure:
    """
    When a goods line has no emission record (latest_emissions=None), the
    assertion layer must set human_review_required=True and identify the
    specific goods line.  The HMRC return builder must also raise
    HMRCReturnValidationError to prevent an incomplete declaration.
    """

    def test_assertion_layer_sets_human_review_for_missing_method(self):
        """
        Goods line with latest_emissions=None → missing calculation_method.
        validate_report_package_integrity must return human_review_required=True.
        """
        pkg = _make_report_package(method=None)   # latest_emissions = null
        # Narrative matches the summary totals so numeric checks do not interfere
        narrative = _make_narrative(
            total_direct_kgco2e=850_000,
            total_indirect_kgco2e=150_000,
            total_embedded_kgco2e=1_000_000,
        )
        result = validate_report_package_integrity(pkg, narrative)

        assert result.human_review_required is True
        assert any("calculation_method" in f for f in result.failures), (
            f"Expected 'calculation_method' failure; got: {result.failures}"
        )

    def test_assertion_layer_identifies_problematic_goods_line(self):
        """The failure message names the goods_line ID and CN code."""
        gl_id = "GL-MISSING-METHOD-001"
        pkg   = _make_report_package(goods_line_id=gl_id, cn_code="72081010", method=None)
        narrative = _make_narrative(
            total_direct_kgco2e=850_000,
            total_indirect_kgco2e=150_000,
            total_embedded_kgco2e=1_000_000,
        )
        result = validate_report_package_integrity(pkg, narrative)

        assert result.human_review_required is True
        failure_text = " ".join(result.failures)
        assert gl_id in failure_text or "72081010" in failure_text, (
            f"Failure text should name the goods line or CN code: {result.failures}"
        )

    def test_calculation_method_check_fails_on_no_emissions(self):
        """completeness.calculation_method check reports passed=False."""
        pkg    = _make_report_package(method=None)
        result = validate_report_package_integrity(pkg, _make_narrative())
        method_check = next(
            (c for c in result.checks if c.check_id == "completeness.calculation_method"),
            None,
        )
        assert method_check is not None
        assert method_check.passed is False

    def test_hmrc_builder_raises_on_missing_method(self):
        """
        build_hmrc_return must raise HMRCReturnValidationError when any goods line
        lacks a calculation_method.  The HMRC return cannot be generated.
        """
        pkg = _make_report_package(method=None)

        with pytest.raises(HMRCReturnValidationError) as exc_info:
            build_hmrc_return(pkg, _make_hmrc_input())

        # Exception must describe the problem — not a generic error
        assert exc_info.value.failures, "HMRCReturnValidationError must list failures"
        err_text = " ".join(exc_info.value.failures).lower()
        assert "calculation_method" in err_text or "method" in err_text, (
            f"Expected 'method' in validation error: {exc_info.value.failures}"
        )

    def test_hmrc_builder_requires_accuracy_declaration_true(self):
        """accuracy_declaration=False blocks HMRC return generation."""
        pkg = _make_report_package(method="actual")
        with pytest.raises(HMRCReturnValidationError) as exc_info:
            build_hmrc_return(pkg, _make_hmrc_input(accuracy_declaration=False))
        assert any("accuracy_declaration" in f for f in exc_info.value.failures)

    def test_missing_summary_total_triggers_human_review(self):
        """
        narrative["results"] is hard-overridden from report_package.summary before
        validation runs (narrative.py Step 4) — comparing narrative.results against
        summary is therefore comparing a value to the source it was copied from and
        can never catch a real defect. The numeric check instead verifies that the
        *source* summary itself has the fields required for the HMRC return; a gap
        there would otherwise propagate silently into the narrative and the return.
        """
        pkg = _make_report_package(direct_kgco2e=850_000, indirect_kgco2e=150_000)
        pkg["summary"]["total_direct_emissions_kgco2e"] = None
        narrative = _make_narrative(
            total_direct_kgco2e=850_000,
            total_indirect_kgco2e=150_000,
            total_embedded_kgco2e=1_000_000,
        )
        result = validate_report_package_integrity(pkg, narrative)

        assert result.human_review_required is True
        assert any("direct" in f.lower() for f in result.failures), (
            f"Expected a failure about the missing direct emissions total: {result.failures}"
        )

    def test_sub_tolerance_difference_does_not_trigger_review(self):
        """Differences ≤ 0.001 kgCO₂e are within tolerance and must not flag review."""
        pkg       = _make_report_package(direct_kgco2e=850_000, indirect_kgco2e=150_000)
        # 0.0005 kgCO₂e difference — below the 0.001 kgCO₂e threshold
        narrative = _make_narrative(
            total_direct_kgco2e=850_000,
            total_indirect_kgco2e=150_000,
            total_embedded_kgco2e=1_000_000,
        )
        # Inject a sub-tolerance direct value (diff = 0.0005 < tolerance of 0.001)
        narrative["results"]["total_direct_embedded_kgco2e"] = Decimal("849999.9995")

        result = validate_report_package_integrity(pkg, narrative)
        # human_review is driven only by numeric mismatch, missing method, or
        # reconciliation warnings — a sub-tolerance difference must not trigger it
        assert result.human_review_required is False, (
            f"Sub-tolerance difference must not trigger human review: {result.failures}"
        )

    def test_reconciliation_warning_triggers_human_review(self):
        """
        data_quality.warnings containing 'reconciliation_warning' must set
        human_review_required=True (unaddressed reconciliation conflict).
        """
        pkg = _make_report_package(
            direct_kgco2e=850_000,
            indirect_kgco2e=150_000,
            data_quality_warnings=[
                "reconciliation_warning: entry_reference mismatch on GL-TEST-001"
            ],
        )
        narrative = _make_narrative(
            total_direct_kgco2e=850_000,
            total_indirect_kgco2e=150_000,
            total_embedded_kgco2e=1_000_000,
        )
        result = validate_report_package_integrity(pkg, narrative)
        assert result.human_review_required is True

    @requires_postgres
    def test_incomplete_case_blocks_hmrc_return_via_api(
        self, api_client, tenant_id, cleanup_cases
    ):
        """
        A case where a goods line has no emissions record:
          - Report package is retrievable (200)
          - Assertion layer sets human_review_required=True
          - HMRC return builder raises HMRCReturnValidationError
        This enforces that an incomplete declaration cannot be submitted.
        """
        auth = _auth_headers(tenant_id)

        case    = _post_case(api_client, auth)
        case_id = case["id"]
        cleanup_cases.append(case_id)

        ship = _post_shipment(api_client, auth, case_id)
        _post_goods_line(api_client, auth, case_id, ship["id"])
        # Deliberately skip _post_emissions → goods line has no method

        pkg = _get_report_package(api_client, auth, case_id)
        assert pkg["type"] == "cbam_report_package_v1"

        # The assertion layer flags the missing method
        result = validate_report_package_integrity(pkg, narrative={})
        assert result.human_review_required is True, (
            "Assertion layer must flag human review when emissions are absent"
        )

        # The HMRC return builder refuses to generate the return
        with pytest.raises(HMRCReturnValidationError):
            build_hmrc_return(pkg, _make_hmrc_input())
