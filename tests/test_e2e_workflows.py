"""
End-to-end integration tests for the Nucleos CBAM compliance platform.

All three tests run against a real PostgreSQL/Supabase database.
Set TEST_DATABASE_URL=postgresql+psycopg2://... to enable.

External APIs mocked:
  - Claude API     (app.services.narrative._call_claude) — monkeypatch
  - Slack webhook  (SLACK_INTERNAL_WEBHOOK_URL)          — respx
  - Resend email   (https://api.resend.com/emails)       — respx

No mocks for the database or Supabase Storage.
"""
from __future__ import annotations

import asyncio
import os
from decimal import Decimal

import pytest

# ── Skip marker ────────────────────────────────────────────────────────────────
# DATABASE_URL is set by conftest.py before this module is imported,
# so the check here reflects the active test database configuration.
_DB_URL = os.environ.get("DATABASE_URL", "")
_HAS_POSTGRES = _DB_URL.startswith("postgresql") or _DB_URL.startswith("postgres")

requires_supabase = pytest.mark.skipif(
    not _HAS_POSTGRES,
    reason=(
        "E2E tests require a real PostgreSQL/Supabase database. "
        "Set TEST_DATABASE_URL=postgresql+psycopg2://... to enable."
    ),
)


# ─────────────────────────────────────────────────────────────────────────────
# Test 1: Steel importer — clean actual data, email notification wiring
# ─────────────────────────────────────────────────────────────────────────────

@requires_supabase
def test_steel_importer_clean_data_email_trigger(
    client,
    tenant_id,
    mock_claude,
    resend_mock,
    slack_mock,
    seed_cbam_rates,
    cleanup_cbam_cases,
):
    """Full CBAM workflow for a steel importer with complete supplier-provided data.

    Verifies:
      - CBAM case creation from a structured parsed invoice (DE origin, EAF route)
      - Report package assembles with a 64-char SHA-256 audit chain reference
      - Tier 1 (actual) method applied to the steel goods line
      - Narrative pipeline completes without triggering human review
      - Compliance pack assembled as cbam_compliance_pack_v1
      - Slack NOT called for a clean, unblocked case
      - Email notification service correctly POSTs to Resend when invoked
        (Finance No.2 Bill 2025-26 record retention wording present in body)

    Regulatory basis:
      UK CBAM Finance No.2 Bill 2025-26 | EU 2023/1773 Art. 4(1)(a) (Tier 1)
    """
    # ── Step 1: Create CBAM case from structured invoice ─────────────────────
    # Steel: 500,000 kg from Germany, EAF route, 850,000 kgCO2e direct.
    # SEE = 850,000 / (500,000 / 1000) = 1,700 kgCO2e/t = 1.7 tCO2e/t
    payload = {
        "importer": {
            "name": "Thyssenkrupp Steel Europe GmbH",
            "eori": f"GB123456789{tenant_id[:3].upper()}",
        },
        "invoice": {
            "invoice_number": "INV-2027-001",
            "invoice_date": "2027-03-15",
            "origin_country": "DE",
            "consignment_reference": "GB-ENTRY-2027-001",
            "net_weight_kg": "500000",
        },
        "lines": [
            {
                "cn_code": "72082700",
                "description": "Flat-rolled products iron or non-alloy steel width 600mm",
                "net_mass_kg": "500000",
                "method": "actual",
                "direct_embedded_kgco2e": "850000",
            }
        ],
    }

    r = client.post("/api/cbam/drafts/from-parsed-invoice", json=payload)
    assert r.status_code == 201, f"Draft creation failed ({r.status_code}): {r.text}"

    body = r.json()
    created = body["created"]
    case_id = created["case_id"]
    goods_line_ids = created["goods_line_ids"]
    cleanup_cbam_cases.append(case_id)

    assert case_id, "case_id must be returned"
    assert len(goods_line_ids) == 1, f"Expected 1 goods line, got {len(goods_line_ids)}"

    # ── Step 2: Fetch and validate report package ─────────────────────────────
    r = client.get(f"/api/cbam/cases/{case_id}/report-package")
    assert r.status_code == 200, f"Report package fetch failed ({r.status_code}): {r.text}"
    rp = r.json()

    assert rp.get("type") == "cbam_report_package_v1", (
        f"Expected type 'cbam_report_package_v1', got {rp.get('type')!r}"
    )

    # Audit chain: payload_hash must be a 64-character hex SHA-256 (Rule 5)
    audit = rp.get("audit") or {}
    payload_hash = (
        audit.get("payload_hash")
        or audit.get("snapshot_hash")
        or ""
    )
    assert len(payload_hash) == 64, (
        f"payload_hash must be 64-char hex SHA-256, got {len(payload_hash)} chars"
    )

    # Data quality must not be blocking for a complete steel invoice
    data_quality = rp.get("data_quality") or {}
    assert not data_quality.get("blocking"), (
        "Steel with complete actual data should not be blocking. "
        f"Missing fields: {data_quality.get('missing', [])}"
    )

    # Summary totals: direct = 850,000 kgCO2e (invoice value, Tier 1)
    summary = rp.get("summary") or {}
    total_direct_kg = summary.get("total_direct_emissions_kgco2e")
    assert total_direct_kg is not None, (
        "summary.total_direct_emissions_kgco2e must be present in the report package"
    )
    assert float(total_direct_kg) == pytest.approx(850_000.0, rel=1e-3), (
        f"Expected ~850,000 kgCO2e direct emissions, got {total_direct_kg}"
    )

    # ── Step 3: Run narrative pipeline ────────────────────────────────────────
    r = client.post(
        f"/api/cases/{case_id}/narrative/pipeline",
        params={"packet_kind": "cbam"},
    )
    assert r.status_code == 200, f"Narrative pipeline failed ({r.status_code}): {r.text}"
    pipeline = r.json()

    assert pipeline.get("case_id") == case_id

    # Claude mock returns fixture narrative; results{} hard-overridden from packet
    narrative = pipeline.get("final_narrative_json") or {}
    assert narrative.get("executive_summary"), "executive_summary must be populated"
    assert narrative.get("methodology"), "methodology must be populated"
    assert isinstance(narrative.get("open_gaps"), list), "open_gaps must be a list"

    # results{} must carry authoritative values overridden from the report package
    # (Claude's empty results{} is replaced by _extract_results_from_packet — Rule 6)
    results = narrative.get("results") or {}
    assert results.get("total_direct_embedded_kgco2e") is not None, (
        "results.total_direct_embedded_kgco2e must be hard-overridden from the report package"
    )

    # Steel with complete actual data: human review must NOT be required
    assert not pipeline.get("human_review_required"), (
        "Steel importer with clean actual data should not require human review. "
        f"Stage errors: {pipeline.get('stage_errors', [])}"
    )

    # ── Step 4: Slack must NOT be called for a clean case ─────────────────────
    # Slack fires only when the deterministic validator sets human_review_required=True.
    assert len(slack_mock.calls) == 0, (
        f"Slack webhook must not be called for a clean steel case. "
        f"Got {len(slack_mock.calls)} call(s)."
    )

    # ── Step 5: Create compliance pack ────────────────────────────────────────
    r = client.post(f"/api/cbam/cases/{case_id}/compliance-pack")
    assert r.status_code == 200, f"Compliance pack creation failed ({r.status_code}): {r.text}"
    pack = r.json()

    assert pack.get("type") == "cbam_compliance_pack_v1", (
        f"Expected 'cbam_compliance_pack_v1', got {pack.get('type')!r}"
    )
    assert "narrative" in pack, (
        f"Compliance pack must contain 'narrative'. Keys: {list(pack.keys())}"
    )
    # Compliance pack audit hash must be a 64-char SHA-256 of the canonical JSON
    pack_audit = pack.get("audit") or {}
    assert len(pack_audit.get("payload_hash", "")) == 64, (
        "compliance_pack_v1 audit.payload_hash must be a 64-char hex SHA-256"
    )

    # Registry submission block must be present (EU 2023/1773 Annex I schema)
    assert "registry_submission" in pack, (
        "Compliance pack must include registry_submission (EU 2023/1773 Annex I)"
    )
    registry = pack["registry_submission"]
    assert registry.get("declarant", {}).get("eori"), (
        "registry_submission.declarant.eori must be present"
    )

    # ── Step 6: Email notification service wiring ─────────────────────────────
    # notify_report_ready is async (httpx.AsyncClient). Run synchronously in test
    # via asyncio.run() — respx intercepts the httpx call within the mock context.
    # This verifies the Resend wiring independently of the pipeline path; the email
    # would be dispatched post-approval via the review endpoint in production.
    from app.services.notifications import notify_report_ready

    asyncio.run(
        notify_report_ready(
            case_id=case_id,
            recipient_email="importer@example.com",
            period="2027 Annual",
            total_liability_gbp_str="£44,540.00",
            base_url="https://app.nucleos.io",
        )
    )

    assert len(resend_mock.calls) == 1, (
        f"notify_report_ready must POST to Resend once, got {len(resend_mock.calls)} call(s)"
    )
    resend_call = resend_mock.calls[0]
    request_body = resend_call.request.json()

    assert request_body.get("to") == ["importer@example.com"], (
        f"Resend 'to' field must be the recipient email: {request_body.get('to')}"
    )
    assert "2027 Annual" in (request_body.get("subject") or ""), (
        f"Email subject must mention the reporting period. Got: {request_body.get('subject')}"
    )
    # Finance No.2 Bill 2025-26 requires 6-year record retention notice in the email
    body_text = request_body.get("text") or ""
    assert "6 years" in body_text, (
        "Email body must include the 6-year record retention notice "
        "(Finance No.2 Bill 2025-26)"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Test 2: Cement importer — missing emissions data, Slack notification wiring
# ─────────────────────────────────────────────────────────────────────────────

@requires_supabase
def test_cement_importer_missing_data_slack_review(
    client,
    tenant_id,
    mock_claude,
    resend_mock,
    slack_mock,
    seed_cbam_rates,
    cleanup_cbam_cases,
):
    """CBAM workflow for a cement importer without supplier-verified emissions data.

    Verifies:
      - Case creation succeeds even without direct_embedded_kgco2e
      - Report package data_quality flags missing emissions (blocking=True) or
        applies Tier 3 defaults with open data quality gaps
      - Pipeline endpoint correctly returns 422 when data is blocking, OR
        runs with Tier 3 defaults when emission factors are seeded
      - Slack notification service (notify_review_required) correctly POSTs to
        the Slack webhook with the case_id and human-readable flags
      - Resend NOT called for a case that is blocked or not yet finalised

    Regulatory basis:
      EU 2023/1773 Art. 4(3) — default values fallback | UK Finance No.2 Bill 2025-26
    """
    # ── Step 1: Create CBAM cement case — no emissions data supplied ──────────
    # Cement from Turkey: 10,000 kg, no direct_embedded_kgco2e.
    # The system should flag missing emissions or apply Tier 3 defaults.
    payload = {
        "importer": {
            "name": "Cimentas Turkey",
            "eori": f"GB987654321{tenant_id[:3].upper()}",
        },
        "invoice": {
            "invoice_number": "INV-CEMENT-2027-042",
            "invoice_date": "2027-06-20",
            "origin_country": "TR",
            "net_weight_kg": "10000",
        },
        "lines": [
            {
                "cn_code": "25232900",
                "description": "Portland cement",
                "net_mass_kg": "10000",
                # Intentionally no direct_embedded_kgco2e — tests missing-data path
            }
        ],
    }

    r = client.post("/api/cbam/drafts/from-parsed-invoice", json=payload)
    assert r.status_code == 201, f"Draft creation failed ({r.status_code}): {r.text}"
    body = r.json()
    case_id = body["created"]["case_id"]
    cleanup_cbam_cases.append(case_id)

    # ── Step 2: Report package — data quality must surface gaps ───────────────
    r = client.get(f"/api/cbam/cases/{case_id}/report-package")
    assert r.status_code == 200, f"Report package fetch failed ({r.status_code}): {r.text}"
    rp = r.json()

    data_quality = rp.get("data_quality") or {}
    missing = data_quality.get("missing") or []
    warnings = data_quality.get("warnings") or []

    # Cement without supplier emissions must have at least one data quality issue
    assert missing or warnings, (
        "Cement case without direct_embedded_kgco2e must have data quality issues. "
        f"Got missing={missing}, warnings={warnings}"
    )

    # ── Step 3: Pipeline endpoint — handle blocking or Tier 3 path ───────────
    r = client.post(
        f"/api/cases/{case_id}/narrative/pipeline",
        params={"packet_kind": "cbam"},
    )

    if data_quality.get("blocking"):
        # Missing_emissions tag → data_quality.blocking=True → 422 gate fires
        assert r.status_code == 422, (
            f"Blocked case (data_quality.blocking=True) must return 422, "
            f"got {r.status_code}: {r.text}"
        )
        block_body = r.json()
        assert block_body.get("data_quality"), (
            "422 response must include the data_quality object"
        )
        assert block_body["data_quality"].get("blocking") is True, (
            "data_quality.blocking must be True in the 422 blocking response"
        )
        # Pipeline was blocked before Claude was called — Slack must not have fired
        assert len(slack_mock.calls) == 0, (
            "Slack must not be called when the pipeline is blocked at the data quality gate"
        )
    else:
        # Tier 3 defaults were applied — pipeline completes
        assert r.status_code == 200, (
            f"Pipeline with Tier 3 defaults must return 200, got {r.status_code}: {r.text}"
        )
        pipeline = r.json()
        # Method warnings present for non-actual method → may or may not flag human review
        # Either way, the narrative must contain an executive_summary
        assert (pipeline.get("final_narrative_json") or {}).get("executive_summary"), (
            "Tier 3 narrative must include executive_summary"
        )

    # ── Step 4: Compliance pack — must be blocked for a missing-data case ─────
    r = client.post(f"/api/cbam/cases/{case_id}/compliance-pack")
    if data_quality.get("blocking"):
        assert r.status_code == 422, (
            f"Compliance pack for a blocked case must return 422, got {r.status_code}: {r.text}"
        )
        assert r.json().get("data_quality", {}).get("blocking") is True

    # ── Step 5: Slack notification service — verify wiring directly ───────────
    # In production, notify_review_required fires as a BackgroundTask after the
    # deterministic validator sets human_review_required=True.
    # We call it directly here to verify the Slack webhook mock is correctly wired,
    # independent of whether the current test run has Postgres Tier 3 factors seeded.
    from app.services.notifications import notify_review_required

    asyncio.run(
        notify_review_required(
            case_id=case_id,
            tenant_name="Cimentas Turkey",
            flags=[
                "Missing supplier-verified emissions data for CN code 25232900 (Portland cement). "
                "Apply EU 2023/1773 Annex VI Tier 3 default values or obtain supplier data."
            ],
            base_url="https://app.nucleos.io",
        )
    )

    slack_calls = slack_mock.calls
    assert len(slack_calls) >= 1, (
        "notify_review_required must POST to the Slack incoming webhook. "
        f"Got {len(slack_calls)} call(s)."
    )

    slack_payload = slack_calls[-1].request.json()
    # Slack Block Kit: top-level "text" is the notification summary
    assert "Human Review Required" in (slack_payload.get("text") or ""), (
        f"Slack message must contain 'Human Review Required'. "
        f"Got text={slack_payload.get('text')!r}"
    )
    # case_id must appear somewhere in the Slack payload for the reviewer to navigate
    slack_str = str(slack_payload)
    assert case_id in slack_str, (
        f"case_id {case_id!r} must appear in the Slack Block Kit payload"
    )
    # Verify the flags text reached the Slack message body
    assert "25232900" in slack_str or "cement" in slack_str.lower(), (
        "The cement CN code or 'cement' must be referenced in the Slack flags"
    )

    # ── Step 6: No Resend email for a blocked / unfinished cement case ────────
    # Resend fires only after a case is formally approved — not for blocked cases.
    assert len(resend_mock.calls) == 0, (
        "Resend must not be called for a cement case with missing emissions data. "
        f"Got {len(resend_mock.calls)} call(s)."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Test 3: Aluminium importer — CPR claim, UK jurisdiction indirect exclusion
# ─────────────────────────────────────────────────────────────────────────────

@requires_supabase
def test_aluminium_importer_cpr_claim_uk_jurisdiction(
    client,
    tenant_id,
    mock_claude,
    resend_mock,
    slack_mock,
    seed_cbam_rates,
    cleanup_cbam_cases,
):
    """CBAM workflow for an aluminium importer with a Norwegian CO₂ tax CPR claim.

    Verifies:
      - Case created with both direct (360 tCO2e) and indirect (520 tCO2e) emissions
      - UK jurisdiction: indirect emissions present in summary but NOT included
        in the CBAM charge calculation (Finance No.2 Bill 2025-26, UK indirect
        exclusion until 2029)
      - CPR arithmetic (Finance No.2 Bill 2025-26 formula):
          net_price_local  = NOK 1155 × 0.074 GBP/NOK = GBP 85.4700 (4dp)
          cpr_raw          = 360 tCO2e × GBP 85.4700  = GBP 30,769.20
          cbam_liability   = 360 tCO2e × GBP 53.10    = GBP 19,116.00  [Q3 2027]
          cpr_final        = min(30,769.20, 19,116.00) = GBP 19,116.00  [CAPPED]
      - CPR claim persisted to cbam_cpr_claims with cpr_capped=True
      - Compliance pack assembled as cbam_compliance_pack_v1
      - Registry submission includes DG TAXUD schema with both direct and indirect
        embedded emissions (EU 2023/1773 Annex I)

    Regulatory basis:
      UK Finance No.2 Bill 2025-26 (CBAM charge = direct only until 2029)
      EU 2023/1773 Art. 4(1)(a) (Tier 1, actual method)
      Finance No.2 Bill 2025-26 CPR formula (secondary legislation Feb 2026)
    """
    # ── Step 1: Create CBAM aluminium case ────────────────────────────────────
    # Norway (NO): direct 360,000 kgCO2e, indirect 520,000 kgCO2e (primary electrolysis)
    # NOK CO2 tax: 1155 NOK/tCO2e, exchange rate 0.074 GBP/NOK
    payload = {
        "importer": {
            "name": "Norsk Hydro ASA",
            "eori": f"GB555444333{tenant_id[:3].upper()}",
        },
        "invoice": {
            "invoice_number": "INV-AL-2027-007",
            "invoice_date": "2027-09-10",
            "origin_country": "NO",
            "net_weight_kg": "200000",
        },
        "lines": [
            {
                "cn_code": "76011000",
                "description": "Aluminium not alloyed unwrought",
                "net_mass_kg": "200000",
                "method": "actual",
                "direct_embedded_kgco2e": "360000",
                "indirect_embedded_kgco2e": "520000",
            }
        ],
    }

    r = client.post("/api/cbam/drafts/from-parsed-invoice", json=payload)
    assert r.status_code == 201, f"Draft creation failed ({r.status_code}): {r.text}"
    body = r.json()
    created = body["created"]
    case_id = created["case_id"]
    goods_line_ids = created["goods_line_ids"]
    cleanup_cbam_cases.append(case_id)

    assert len(goods_line_ids) == 1, f"Expected 1 goods line, got {len(goods_line_ids)}"
    goods_line_id = goods_line_ids[0]

    # ── Step 2: Report package — direct + indirect, UK indirect exclusion ─────
    r = client.get(f"/api/cbam/cases/{case_id}/report-package")
    assert r.status_code == 200, f"Report package fetch failed ({r.status_code}): {r.text}"
    rp = r.json()

    assert rp.get("type") == "cbam_report_package_v1"
    assert not (rp.get("data_quality") or {}).get("blocking"), (
        "Aluminium case with full data should not be blocking. "
        f"Missing: {(rp.get('data_quality') or {}).get('missing', [])}"
    )

    summary = rp.get("summary") or {}

    # Direct embedded emissions: 360,000 kgCO2e (from supplier, Tier 1)
    total_direct_kg = float(summary.get("total_direct_emissions_kgco2e") or 0)
    assert total_direct_kg == pytest.approx(360_000.0, rel=1e-3), (
        f"Expected 360,000 kgCO2e direct emissions, got {total_direct_kg}"
    )

    # Indirect embedded emissions (520 tCO2e) must be captured in the summary
    # (required for EU registry reporting even though not included in UK charge)
    total_indirect_kg = float(summary.get("total_indirect_emissions_kgco2e") or 0)
    assert total_indirect_kg == pytest.approx(520_000.0, rel=1e-3), (
        f"Expected 520,000 kgCO2e indirect emissions in summary, got {total_indirect_kg}"
    )

    # UK jurisdiction: CBAM charge must be based on DIRECT emissions only.
    # If indirect (520 tCO2e) were included: (360+520) × £53.10 = £46,728.
    # Correct UK charge (direct only): 360 × £53.10 = £19,116.
    # Check HMRC return block when populated by the report builder.
    hmrc_return = rp.get("hmrc_return") or {}
    consignments = hmrc_return.get("consignments") or []
    if consignments:
        for consignment in consignments:
            for gl in consignment.get("goods_lines") or []:
                cbam_charge = float(gl.get("cbam_charge_gbp") or 0)
                # Charge must be well below what it would be if indirect were included
                assert cbam_charge < 25_000.0, (
                    f"UK CBAM charge ({cbam_charge}) appears to include indirect "
                    f"emissions — per Finance No.2 Bill 2025-26, indirect (electricity) "
                    f"is excluded from the UK CBAM charge until 2029. "
                    f"Expected ≤ £19,116 (direct only at £53.10/tCO2e Q3 2027)."
                )

    # ── Step 3: Run narrative pipeline ────────────────────────────────────────
    r = client.post(
        f"/api/cases/{case_id}/narrative/pipeline",
        params={"packet_kind": "cbam"},
    )
    assert r.status_code == 200, f"Narrative pipeline failed ({r.status_code}): {r.text}"
    pipeline = r.json()

    assert pipeline.get("case_id") == case_id
    # results{} hard-overridden with authoritative values (Rule 6)
    results = (pipeline.get("final_narrative_json") or {}).get("results") or {}
    assert results.get("total_direct_embedded_kgco2e") is not None, (
        "results.total_direct_embedded_kgco2e must be overridden from report package"
    )

    # ── Step 4: CPR calculation — Norwegian CO₂ tax (NOK 1155/tCO2e) ─────────
    #
    # Finance No.2 Bill 2025-26 CPR formula:
    #   effective_price_gbp = (carbon_price_local − free_allocations − rebates)
    #                         × exchange_rate_to_gbp
    #   cpr_raw_gbp         = verified_emissions_tco2e × effective_price_gbp
    #   cpr_final_gbp       = min(cpr_raw_gbp, cbam_liability_gbp)  [cap Rule 7]
    #
    # Input values:
    #   carbon_price_local  = NOK 1155/tCO2e
    #   free_allocations    = 0
    #   rebates             = 0
    #   exchange_rate       = 0.074 GBP/NOK  (HMRC CDRM rate on import date)
    #   verified_emissions  = 360 tCO2e  (direct only — UK excludes indirect)
    #   cbam_liability      = 360 × £53.10 = £19,116.00  (Q3 2027 rate)
    #
    # Expected intermediate values (from cpr_calculator.py rounding logic):
    #   net_price_local         = 1155.0000 NOK/tCO2e
    #   effective_carbon_price  = _local(1155 × 0.074) = 85.4700 GBP/tCO2e
    #   cpr_raw                 = _gbp(360 × 85.4700)  = 30,769.20 GBP
    #   cpr_capped              = True  (30,769.20 > 19,116.00)
    #   cpr_amount              = 19,116.00 GBP

    cpr_request = {
        "verified_emissions_tco2e": "360",
        "carbon_price_local":       "1155",
        "currency_code":            "NOK",
        "free_allocations":         "0",
        "rebates":                  "0",
        "exchange_rate_to_gbp":     "0.074",
        "cbam_liability_gbp":       "19116.00",
    }

    r = client.post("/api/cbam/cpr/calculate", json=cpr_request)
    assert r.status_code == 200, f"CPR calculation failed ({r.status_code}): {r.text}"
    cpr_calc = r.json()

    # net_price_local = 1155 - 0 - 0 = 1155, rounded to 4dp = 1155.0000 NOK
    assert Decimal(cpr_calc["net_price_local"]) == Decimal("1155.0000"), (
        f"net_price_local: expected 1155.0000 NOK, got {cpr_calc['net_price_local']!r}"
    )

    # effective_carbon_price_gbp = _local(1155.0000 × 0.074) = 85.4700 GBP/tCO2e
    assert Decimal(cpr_calc["effective_carbon_price_gbp"]) == Decimal("85.4700"), (
        f"effective_carbon_price_gbp: expected 85.4700, got {cpr_calc['effective_carbon_price_gbp']!r}"
    )

    # cpr_raw = _gbp(360 × 85.4700) = 30,769.20 GBP
    assert Decimal(cpr_calc["cpr_raw_gbp"]) == Decimal("30769.20"), (
        f"cpr_raw_gbp: expected £30,769.20, got {cpr_calc['cpr_raw_gbp']!r}"
    )

    # CPR must be capped: cpr_raw (£30,769.20) > cbam_liability (£19,116.00)
    assert cpr_calc["cpr_capped"] is True, (
        f"CPR must be capped when cpr_raw ({cpr_calc['cpr_raw_gbp']}) "
        f"> cbam_liability ({cpr_calc['cbam_liability_gbp']})"
    )

    # cpr_amount = min(30,769.20, 19,116.00) = £19,116.00
    assert Decimal(cpr_calc["cpr_amount_gbp"]) == Decimal("19116.00"), (
        f"cpr_amount_gbp: expected £19,116.00 (capped at CBAM liability), "
        f"got {cpr_calc['cpr_amount_gbp']!r}"
    )

    # Qualifier check: Norway (NO) is an EEA EU ETS participant
    schemes_r = client.get("/api/cbam/cpr/qualifying-schemes", params={"country": "NO"})
    if schemes_r.status_code == 200:
        schemes_body = schemes_r.json()
        assert schemes_body.get("cpr_claimable") is True, (
            "Norway (NO) must be listed as CPR-claimable (EEA EU ETS participant)"
        )

    # ── Step 5: Create CPR claim ──────────────────────────────────────────────
    # POST to /api/cbam/cpr/claims to persist the claim to cbam_cpr_claims.
    # The API re-runs the CPR formula server-side from the raw inputs.
    claim_request = {
        "goods_line_id":              goods_line_id,
        "origin_country_code":        "NO",
        "qualifying_scheme_name":     "Norwegian CO2 Tax",
        "carbon_price_local_currency":"1155",
        "local_currency_code":        "NOK",
        "free_allocations_received":  "0",
        "rebates_received":           "0",
        "verified_emissions_tco2e":   "360",
        "exchange_rate_to_gbp":       "0.074",
        "exchange_rate_date":         "2027-09-10",
        "cbam_liability_gbp":         "19116.00",
        "verifier_name":              "Lloyd's Register EMEA",
        "verifier_accreditation_body":"UKAS",
    }

    r = client.post("/api/cbam/cpr/claims", json=claim_request)
    assert r.status_code == 201, f"CPR claim creation failed ({r.status_code}): {r.text}"
    claim = r.json()

    assert claim.get("cpr_capped") is True, (
        "Persisted CPR claim must record cpr_capped=True"
    )
    assert Decimal(str(claim["cpr_amount_gbp"])) == Decimal("19116.00"), (
        f"Persisted cpr_amount_gbp must be £19,116.00 (capped), "
        f"got {claim.get('cpr_amount_gbp')!r}"
    )
    claim_id = claim.get("id")
    assert claim_id, "CPR claim must return a UUID id"

    # Retrieve the claim to verify it is correctly stored
    retrieve_r = client.get(f"/api/cbam/cpr/claims/{goods_line_id}")
    if retrieve_r.status_code == 200:
        claims_body = retrieve_r.json()
        claim_ids = [c.get("id") for c in (claims_body.get("claims") or [])]
        assert claim_id in claim_ids, (
            f"Created CPR claim {claim_id} must appear in GET /cbam/cpr/claims/{goods_line_id}"
        )

    # ── Step 6: Create compliance pack ────────────────────────────────────────
    r = client.post(f"/api/cbam/cases/{case_id}/compliance-pack")
    assert r.status_code == 200, f"Compliance pack failed ({r.status_code}): {r.text}"
    pack = r.json()

    assert pack.get("type") == "cbam_compliance_pack_v1", (
        f"Expected 'cbam_compliance_pack_v1', got {pack.get('type')!r}"
    )
    assert "narrative" in pack, (
        f"Compliance pack must include narrative. Keys: {list(pack.keys())}"
    )

    # Registry submission (EU 2023/1773 Annex I): both direct and indirect must appear
    registry = pack.get("registry_submission") or {}
    import_entries = registry.get("importEntries") or []
    if import_entries:
        for entry in import_entries:
            for goods_item in entry.get("goods") or []:
                emdet = goods_item.get("emissionsDetermination") or {}
                # Indirect embedded emissions must be in the registry submission
                # (EU reports both for aluminium, even though UK charge excludes indirect)
                indirect_tco2e = emdet.get("indirectEmbeddedEmissionsTco2e", 0)
                assert float(indirect_tco2e) == pytest.approx(520.0, rel=1e-3), (
                    f"Registry submission indirect emissions: expected 520.0 tCO2e, "
                    f"got {indirect_tco2e}. Indirect must be included for EU reporting "
                    f"(EU 2023/1773 Annex I) even when excluded from UK CBAM charge."
                )

    # ── Step 7: Audit trail — payload_hash must be present ───────────────────
    pack_audit = pack.get("audit") or {}
    assert len(pack_audit.get("payload_hash", "")) == 64, (
        "compliance_pack_v1 audit.payload_hash must be a 64-char hex SHA-256"
    )

    # ── Step 8: Slack and Resend not fired in the happy path ──────────────────
    # Slack fires only if human_review_required=True; Resend after formal approval.
    if not pipeline.get("human_review_required"):
        assert len(slack_mock.calls) == 0, (
            "Slack must not be called when human_review_required=False"
        )
    assert len(resend_mock.calls) == 0, (
        "Resend email must not be fired from the pipeline or compliance-pack endpoints"
    )
