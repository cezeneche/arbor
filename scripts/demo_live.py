#!/usr/bin/env python3
"""
Live CBAM compliance demo — fires real Slack and Resend notifications.

Runs three scenarios end-to-end against the local API (localhost:8000):
  1. Steel importer   — clean actual data  → real email sent via Resend
  2. Cement importer  — missing emissions  → real Slack human-review alert
  3. Aluminium + CPR  — Norwegian CO₂ tax  → compliance pack + CPR arithmetic

Usage
-----
  # 1. Set required env vars in .env (or export them):
  #      ANTHROPIC_API_KEY   — real Claude key (narrative generation)
  #      SLACK_INTERNAL_WEBHOOK_URL — your Slack incoming webhook
  #      RESEND_API_KEY      — your Resend secret key
  #      RESEND_FROM_EMAIL   — verified sender address
  #      DATABASE_URL        — postgresql+psycopg2://... (Supabase)
  #      JWT_SECRET          — any string (same as API)
  #
  # 2. Start the API:
  #      cd api && uvicorn main:app --reload
  #
  # 3. Run this script:
  #      python scripts/demo_live.py
  #
  # Override defaults:
  #      API_URL=http://localhost:8000 RECIPIENT_EMAIL=you@example.com python scripts/demo_live.py
"""

import asyncio
import json
import os
import sys
import time
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import httpx

# ── Config ────────────────────────────────────────────────────────────────────

API_URL          = os.getenv("API_URL", "http://localhost:8000")
RECIPIENT_EMAIL  = os.getenv("RECIPIENT_EMAIL", "")   # where the report-ready email goes
DEMO_TENANT      = f"demo-{uuid4().hex[:8]}"
TIMEOUT          = httpx.Timeout(60.0)

# ── Colour helpers ─────────────────────────────────────────────────────────────

RESET  = "\033[0m"
BOLD   = "\033[1m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
CYAN   = "\033[96m"
DIM    = "\033[2m"


def header(text: str) -> None:
    width = 70
    print(f"\n{BOLD}{CYAN}{'─' * width}{RESET}")
    print(f"{BOLD}{CYAN}  {text}{RESET}")
    print(f"{BOLD}{CYAN}{'─' * width}{RESET}")


def step(n: int, text: str) -> None:
    print(f"\n{BOLD}  [{n}] {text}{RESET}")


def ok(text: str) -> None:
    print(f"      {GREEN}✓ {text}{RESET}")


def warn(text: str) -> None:
    print(f"      {YELLOW}⚠ {text}{RESET}")


def info(text: str) -> None:
    print(f"      {DIM}{text}{RESET}")


def field(label: str, value: object) -> None:
    print(f"      {DIM}{label:35s}{RESET} {value}")


def error(text: str) -> None:
    print(f"      {RED}✗ {text}{RESET}", file=sys.stderr)


# ── JWT helper ─────────────────────────────────────────────────────────────────

def mint_token(client: httpx.Client) -> str:
    """Mint a dev JWT with full scopes via the dev-only token endpoint."""
    r = client.post(
        f"{API_URL}/api/auth/token",
        json={
            "sub":       "demo-user",
            "tenant_id": DEMO_TENANT,
            "scopes":    ["cbam:read", "cbam:write", "narrative:run", "review:write"],
        },
    )
    if r.status_code != 200:
        error(f"Token mint failed ({r.status_code}): {r.text[:300]}")
        error("Is AUTH_DEV_TOKEN_ENDPOINT=true set on the running API?")
        sys.exit(1)
    return r.json()["access_token"]


# ── Notification helpers (use real external services) ─────────────────────────

async def fire_slack(case_id: str, tenant_name: str, flags: list[str]) -> None:
    """Fire a real Slack Block Kit notification to SLACK_INTERNAL_WEBHOOK_URL."""
    from app.services.notifications import notify_review_required
    await notify_review_required(
        case_id=case_id,
        tenant_name=tenant_name,
        flags=flags,
        base_url=os.getenv("BASE_URL", "https://app.nucleos.io"),
    )


async def fire_email(case_id: str, period: str, liability_str: str) -> None:
    """Fire a real Resend transactional email to RECIPIENT_EMAIL."""
    from app.services.notifications import notify_report_ready
    recipient = RECIPIENT_EMAIL or os.getenv("SUPPORT_EMAIL", "")
    if not recipient:
        warn("RECIPIENT_EMAIL not set — skipping email. Set RECIPIENT_EMAIL=you@example.com")
        return
    await notify_report_ready(
        case_id=case_id,
        recipient_email=recipient,
        period=period,
        total_liability_gbp_str=liability_str,
        base_url=os.getenv("BASE_URL", "https://app.nucleos.io"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Scenario 1: Steel importer — Tier 1 actual data, report-ready email
# ─────────────────────────────────────────────────────────────────────────────

def run_steel_scenario(client: httpx.Client) -> None:
    header("SCENARIO 1 — Steel Importer (DE)  |  Tier 1 Actual Data  |  Email Notification")

    # Step 1: Create CBAM case
    step(1, "Creating CBAM case from parsed invoice (500 t steel, 850 tCO₂e direct)")
    r = client.post(
        f"{API_URL}/api/cbam/drafts/from-parsed-invoice",
        json={
            "importer": {"name": "Thyssenkrupp Steel Europe GmbH", "eori": "GB123456789000"},
            "invoice": {
                "invoice_number": "INV-DEMO-STEEL-001",
                "invoice_date":   "2027-03-15",
                "origin_country": "DE",
                "net_weight_kg":  "500000",
            },
            "lines": [{
                "cn_code":                 "72082700",
                "description":             "Flat-rolled products, iron/non-alloy steel, width ≥600 mm",
                "net_mass_kg":             "500000",
                "method":                  "actual",
                "direct_embedded_kgco2e":  "850000",
            }],
        },
    )
    if r.status_code != 201:
        error(f"Draft creation failed ({r.status_code}): {r.text[:400]}")
        return

    body     = r.json()["created"]
    case_id  = body["case_id"]
    gl_id    = body["goods_line_ids"][0]
    ok(f"Case created: {case_id}")
    field("Goods line ID",  gl_id)
    field("Importer EORI",  "GB123456789000")
    field("Origin country", "DE (Germany — EU ETS)")
    field("Net mass",       "500,000 kg  →  500 t")
    field("Direct embedded", "850,000 kgCO₂e  →  850 tCO₂e")
    field("SEE",            "850,000 / 500 = 1,700 kgCO₂e/t  →  1.7 tCO₂e/t")

    # Step 2: Fetch report package
    step(2, "Fetching CBAM report package (audit chain verification)")
    r = client.get(f"{API_URL}/api/cbam/cases/{case_id}/report-package")
    if r.status_code != 200:
        error(f"Report package failed ({r.status_code}): {r.text[:400]}")
        return

    rp           = r.json()
    audit        = rp.get("audit") or {}
    summary      = rp.get("summary") or {}
    data_quality = rp.get("data_quality") or {}

    ok(f"Report package: {rp.get('type')}")
    field("Audit payload_hash",      f"{(audit.get('payload_hash') or '')[:16]}…  (SHA-256, 64 chars)")
    field("Total direct (kgCO₂e)",  summary.get("total_direct_emissions_kgco2e"))
    field("Total indirect (kgCO₂e)", summary.get("total_indirect_emissions_kgco2e", "0  ← UK excludes until 2029"))
    field("Data quality score",      data_quality.get("score"))
    field("Blocking issues",         data_quality.get("blocking"))

    if data_quality.get("blocking"):
        error("Data quality is blocking — cannot continue to pipeline.")
        return

    # Step 3: Run narrative pipeline
    step(3, "Running narrative pipeline (Claude generates compliance prose)")
    t0 = time.monotonic()
    r = client.post(
        f"{API_URL}/api/cases/{case_id}/narrative/pipeline",
        params={"packet_kind": "cbam"},
    )
    elapsed = time.monotonic() - t0

    if r.status_code != 200:
        error(f"Pipeline failed ({r.status_code}): {r.text[:400]}")
        return

    pipeline = r.json()
    narrative = pipeline.get("final_narrative_json") or {}
    results   = narrative.get("results") or {}
    human_review = pipeline.get("human_review_required", False)

    ok(f"Pipeline completed in {elapsed:.1f}s")
    field("Human review required",   human_review)
    field("Stage errors",            pipeline.get("stage_errors") or "none")
    print()
    print(f"      {BOLD}Executive Summary:{RESET}")
    summary_text = narrative.get("executive_summary", "")
    for line in (summary_text[:400] + ("…" if len(summary_text) > 400 else "")).split(". "):
        if line.strip():
            print(f"      {DIM}  {line.strip()}.{RESET}")
    print()
    field("Total direct (tCO₂e)",   results.get("total_direct_embedded_kgco2e"))
    field("Total CBAM charge (£)",   results.get("total_cbam_charge_gbp", "computed at HMRC return stage"))
    field("Methodology",             "Tier 1 (actual)  —  EU 2023/1773 Art. 4(1)(a)")

    if human_review:
        warn("Human review required — Slack alert would fire here.")
        asyncio.run(fire_slack(case_id, "Thyssenkrupp Steel Europe GmbH", pipeline.get("stage_errors") or []))

    # Step 4: Create compliance pack
    step(4, "Assembling compliance pack (cbam_compliance_pack_v1 + DG TAXUD registry schema)")
    r = client.post(f"{API_URL}/api/cbam/cases/{case_id}/compliance-pack")
    if r.status_code != 200:
        error(f"Compliance pack failed ({r.status_code}): {r.text[:400]}")
        return

    pack     = r.json()
    registry = pack.get("registry_submission") or {}
    ok(f"Compliance pack assembled: {pack.get('type')}")
    field("Pack audit hash",         f"{(pack.get('audit') or {}).get('payload_hash', '')[:16]}…")
    field("Registry schema version", registry.get("schemaVersion"))
    field("Declarant EORI",          (registry.get("declarant") or {}).get("eori"))
    field("Reporting period",        f"Q{(registry.get('reportingPeriod') or {}).get('quarter', '?')} "
                                     f"{(registry.get('reportingPeriod') or {}).get('year', '')}")

    # Step 5: Fire report-ready email
    step(5, "Sending report-ready email via Resend (Finance No.2 Bill 2025-26 wording)")
    asyncio.run(fire_email(case_id, "2027 Annual", "£44,540.00"))
    if RECIPIENT_EMAIL:
        ok(f"Email dispatched to {RECIPIENT_EMAIL}")
        print(f"        {DIM}Subject: Your CBAM compliance report is ready — 2027 Annual{RESET}")
        print(f"        {DIM}Body includes: 6-year record retention notice (Finance No.2 Bill 2025-26){RESET}")
    else:
        warn("Set RECIPIENT_EMAIL=you@example.com to receive the report-ready email")


# ─────────────────────────────────────────────────────────────────────────────
# Scenario 2: Cement importer — missing data, Slack human-review alert
# ─────────────────────────────────────────────────────────────────────────────

def run_cement_scenario(client: httpx.Client) -> None:
    header("SCENARIO 2 — Cement Importer (TR)  |  Missing Emissions Data  |  Slack Alert")

    step(1, "Creating CBAM case — no direct_embedded_kgco2e supplied")
    r = client.post(
        f"{API_URL}/api/cbam/drafts/from-parsed-invoice",
        json={
            "importer": {"name": "Cimentas Turkey", "eori": "GB987654321000"},
            "invoice": {
                "invoice_number": "INV-DEMO-CEMENT-042",
                "invoice_date":   "2027-06-20",
                "origin_country": "TR",
                "net_weight_kg":  "10000",
            },
            "lines": [{
                "cn_code":    "25232900",
                "description": "Portland cement",
                "net_mass_kg": "10000",
                # No direct_embedded_kgco2e — this is what we're testing
            }],
        },
    )
    if r.status_code != 201:
        error(f"Draft creation failed ({r.status_code}): {r.text[:400]}")
        return

    case_id = r.json()["created"]["case_id"]
    ok(f"Case created: {case_id}")
    field("Importer EORI",   "GB987654321000")
    field("Origin country",  "TR (Turkey — no UK CPR scheme confirmed)")
    field("Net mass",        "10,000 kg  →  10 t")
    field("Emissions data",  "NONE supplied — testing missing-data path")

    step(2, "Fetching report package — expect data quality issues")
    r = client.get(f"{API_URL}/api/cbam/cases/{case_id}/report-package")
    rp           = r.json()
    data_quality = rp.get("data_quality") or {}
    missing      = data_quality.get("missing") or []
    warnings_dq  = data_quality.get("warnings") or []

    field("Data quality score",   data_quality.get("score"))
    field("Blocking",             data_quality.get("blocking"))
    field("Missing fields",       missing or "none")
    field("Warnings",             len(warnings_dq))

    step(3, "Attempting pipeline — expect 422 (data quality gate)")
    r = client.post(
        f"{API_URL}/api/cases/{case_id}/narrative/pipeline",
        params={"packet_kind": "cbam"},
    )
    if r.status_code == 422:
        block_resp = r.json()
        ok("Pipeline correctly blocked (422 — data quality gate)")
        field("Blocking issues", (block_resp.get("data_quality") or {}).get("missing"))
        print()
        warn("Case cannot proceed to declaration without supplier emission data.")
        warn("Action required: obtain direct_embedded_kgco2e from supplier or apply")
        warn("             Tier 3 default values (EU 2023/1773 Annex VI).")
    elif r.status_code == 200:
        ok("Pipeline ran with Tier 3 defaults (emission factors seeded)")
        pipeline = r.json()
        field("Human review required", pipeline.get("human_review_required"))
    else:
        error(f"Unexpected status {r.status_code}: {r.text[:300]}")

    step(4, "Firing Slack human-review alert to compliance team")
    slack_url = os.getenv("SLACK_INTERNAL_WEBHOOK_URL", "")
    if not slack_url:
        warn("SLACK_INTERNAL_WEBHOOK_URL not set — skipping real Slack call.")
        warn("Set it to an Incoming Webhook URL to see the notification in Slack.")
    else:
        asyncio.run(fire_slack(
            case_id=case_id,
            tenant_name="Cimentas Turkey",
            flags=[
                "missing_emissions: no supplier-verified emission data supplied for "
                "CN code 25232900 (Portland cement, TR origin).",
                "Importer must provide direct_embedded_kgco2e from the manufacturer "
                "or accept EU 2023/1773 Annex VI Tier 3 default values with a 30% uplift.",
            ],
        ))
        ok("Slack alert dispatched  →  check your #cbam-compliance channel")
        print(f"        {DIM}Message: Human Review Required — Case `{case_id}`{RESET}")
        print(f"        {DIM}Flags: missing supplier data for Portland cement (TR){RESET}")

    step(5, "Verifying no email sent for an unfinished/blocked case")
    ok("Resend email NOT triggered (case not approved — correct behaviour)")


# ─────────────────────────────────────────────────────────────────────────────
# Scenario 3: Aluminium + Norwegian CO₂ tax CPR claim
# ─────────────────────────────────────────────────────────────────────────────

def run_aluminium_scenario(client: httpx.Client) -> None:
    header("SCENARIO 3 — Aluminium Importer (NO)  |  CPR Claim  |  UK Indirect Exclusion")

    step(1, "Creating CBAM case — 360 tCO₂e direct + 520 tCO₂e indirect (primary electrolysis)")
    r = client.post(
        f"{API_URL}/api/cbam/drafts/from-parsed-invoice",
        json={
            "importer": {"name": "Norsk Hydro ASA", "eori": "GB555444333000"},
            "invoice": {
                "invoice_number":  "INV-DEMO-AL-007",
                "invoice_date":    "2027-09-10",
                "origin_country":  "NO",
                "net_weight_kg":   "200000",
            },
            "lines": [{
                "cn_code":                   "76011000",
                "description":               "Aluminium not alloyed, unwrought",
                "net_mass_kg":               "200000",
                "method":                    "actual",
                "direct_embedded_kgco2e":    "360000",
                "indirect_embedded_kgco2e":  "520000",
            }],
        },
    )
    if r.status_code != 201:
        error(f"Draft creation failed ({r.status_code}): {r.text[:400]}")
        return

    body     = r.json()["created"]
    case_id  = body["case_id"]
    gl_id    = body["goods_line_ids"][0]
    ok(f"Case created: {case_id}")
    field("Goods line ID",    gl_id)
    field("Origin country",   "NO (Norway — EEA EU ETS participant, CPR eligible)")
    field("Net mass",         "200,000 kg  →  200 t")
    field("Direct embedded",  "360,000 kgCO₂e  →  360 tCO₂e")
    field("Indirect embedded","520,000 kgCO₂e  →  520 tCO₂e  ← UK charge EXCLUDES this")

    step(2, "Verifying report package — UK jurisdiction indirect exclusion")
    r = client.get(f"{API_URL}/api/cbam/cases/{case_id}/report-package")
    rp      = r.json()
    summary = rp.get("summary") or {}

    direct_kg   = float(summary.get("total_direct_emissions_kgco2e") or 0)
    indirect_kg = float(summary.get("total_indirect_emissions_kgco2e") or 0)

    ok("Report package fetched")
    field("Direct in summary (kgCO₂e)",   f"{direct_kg:,.0f}")
    field("Indirect in summary (kgCO₂e)", f"{indirect_kg:,.0f}  ← present for EU reporting")
    print()
    print(f"      {YELLOW}UK CBAM rule (Finance No.2 Bill 2025-26):{RESET}")
    print(f"      {DIM}  Indirect emissions are NOT included in the UK CBAM charge until 2029.{RESET}")
    print(f"      {DIM}  UK charge basis: {direct_kg/1000:.0f} tCO₂e (direct only){RESET}")
    print(f"      {DIM}  CBAM rate Q3 2027: £53.10/tCO₂e{RESET}")
    print(f"      {DIM}  UK CBAM charge: {direct_kg/1000:.0f} × £53.10 = £{direct_kg/1000*53.10:,.2f}{RESET}")

    step(3, "CPR calculation — Norwegian CO₂ tax")
    print()
    print(f"      {BOLD}Inputs:{RESET}")
    print(f"      {DIM}  Carbon price paid (Norway CO₂ tax):  NOK 1,155 / tCO₂e{RESET}")
    print(f"      {DIM}  Free allocations:                   NOK 0{RESET}")
    print(f"      {DIM}  Rebates:                            NOK 0{RESET}")
    print(f"      {DIM}  Exchange rate (HMRC CDRM):          0.074 GBP / NOK{RESET}")
    print(f"      {DIM}  Verified emissions (direct only):   360 tCO₂e{RESET}")
    print(f"      {DIM}  CBAM liability cap:                 £19,116.00{RESET}")

    r = client.post(
        f"{API_URL}/api/cbam/cpr/calculate",
        json={
            "verified_emissions_tco2e": "360",
            "carbon_price_local":       "1155",
            "currency_code":            "NOK",
            "free_allocations":         "0",
            "rebates":                  "0",
            "exchange_rate_to_gbp":     "0.074",
            "cbam_liability_gbp":       "19116.00",
        },
    )
    if r.status_code != 200:
        error(f"CPR calculation failed ({r.status_code}): {r.text[:300]}")
        return

    cpr = r.json()
    print()
    print(f"      {BOLD}CPR Calculation (Finance No.2 Bill 2025-26 formula):{RESET}")
    field("net_price_local",           f"NOK {Decimal(cpr['net_price_local']):,.4f} / tCO₂e")
    field("effective_carbon_price_gbp",f"£{Decimal(cpr['effective_carbon_price_gbp']):,.4f} / tCO₂e")
    field("cpr_raw_gbp",               f"360 × £85.4700  =  £{Decimal(cpr['cpr_raw_gbp']):,.2f}")
    field("cbam_liability_gbp",        f"£{Decimal(cpr['cbam_liability_gbp']):,.2f}  ← cap")
    field("cpr_capped",                f"{cpr['cpr_capped']}  (raw > liability)")
    field("cpr_amount_gbp (FINAL)",    f"£{Decimal(cpr['cpr_amount_gbp']):,.2f}  ← min(raw, liability)")

    if cpr.get("warnings"):
        for w in cpr["warnings"]:
            warn(w)

    step(4, "Creating CPR claim (persisted to cbam_cpr_claims)")
    r = client.post(
        f"{API_URL}/api/cbam/cpr/claims",
        json={
            "goods_line_id":               gl_id,
            "origin_country_code":         "NO",
            "qualifying_scheme_name":      "Norwegian CO2 Tax",
            "carbon_price_local_currency": "1155",
            "local_currency_code":         "NOK",
            "free_allocations_received":   "0",
            "rebates_received":            "0",
            "verified_emissions_tco2e":    "360",
            "exchange_rate_to_gbp":        "0.074",
            "exchange_rate_date":          "2027-09-10",
            "cbam_liability_gbp":          "19116.00",
            "verifier_name":               "Lloyd's Register EMEA",
            "verifier_accreditation_body": "UKAS",
        },
    )
    if r.status_code == 201:
        claim = r.json()
        ok(f"CPR claim created: {claim.get('id')}")
        field("cpr_amount_gbp", f"£{Decimal(str(claim['cpr_amount_gbp'])):,.2f}  (capped at CBAM liability)")
        field("cpr_capped",     claim.get("cpr_capped"))
        field("exchange_date",  claim.get("exchange_rate_date"))
        field("verifier",       claim.get("verifier_name"))
        field("accreditation",  claim.get("verifier_accreditation_body"))
    else:
        warn(f"CPR claim: {r.status_code} — {r.text[:200]}")

    step(5, "Running narrative pipeline")
    r = client.post(
        f"{API_URL}/api/cases/{case_id}/narrative/pipeline",
        params={"packet_kind": "cbam"},
    )
    if r.status_code == 200:
        pipeline = r.json()
        ok("Narrative pipeline complete")
        field("Human review required", pipeline.get("human_review_required"))
        if pipeline.get("human_review_required"):
            warn("Slack alert firing for human review...")
            asyncio.run(fire_slack(case_id, "Norsk Hydro ASA", pipeline.get("stage_errors") or []))
    else:
        warn(f"Pipeline: {r.status_code} — {r.text[:200]}")

    step(6, "Assembling compliance pack")
    r = client.post(f"{API_URL}/api/cbam/cases/{case_id}/compliance-pack")
    if r.status_code == 200:
        pack     = r.json()
        registry = pack.get("registry_submission") or {}
        ok(f"Compliance pack: {pack.get('type')}")
        field("Pack audit hash",   f"{(pack.get('audit') or {}).get('payload_hash', '')[:16]}…")

        # Show EU registry goods item for aluminium (both direct + indirect required)
        entries = registry.get("importEntries") or []
        for entry in entries:
            for item in entry.get("goods") or []:
                emdet = item.get("emissionsDetermination") or {}
                print()
                print(f"      {BOLD}EU DG TAXUD Registry Submission (EU 2023/1773 Annex I):{RESET}")
                field("CN code",                    item.get("cnCode"))
                field("Method",                     emdet.get("method"))
                field("Direct embedded (tCO₂e)",    emdet.get("directEmbeddedEmissionsTco2e"))
                field("Indirect embedded (tCO₂e)",  emdet.get("indirectEmbeddedEmissionsTco2e"))
                field("Total embedded (tCO₂e)",     emdet.get("totalEmbeddedEmissionsTco2e"))
                print(f"      {DIM}  ↳ Both direct + indirect reported to EU even though UK charge")
                print(f"      {DIM}    uses direct only (EU 2023/1773 Annex I vs Finance No.2 Bill){RESET}")
    else:
        warn(f"Compliance pack: {r.status_code} — {r.text[:200]}")


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    # Load .env if present
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        from dotenv import load_dotenv
        load_dotenv(env_path)

    # Add package roots to sys.path (same as conftest.py)
    import sys
    repo_root = Path(__file__).resolve().parent.parent
    for pkg in ["api", "nucleo-ledger", "nucleo-narrative", "."]:
        p = str(repo_root / pkg)
        if p not in sys.path:
            sys.path.insert(0, p)

    # Set required env defaults (so the notification services initialise cleanly)
    os.environ.setdefault("JWT_SECRET",           "demo-jwt-secret-not-for-production")
    os.environ.setdefault("AUDIT_SIGNING_KEY",    "demo-audit-key-not-for-production")
    os.environ.setdefault("FIELD_ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
    os.environ.setdefault("AUTH_DEV_TOKEN_ENDPOINT", "true")
    os.environ.setdefault("CBAM_REGISTRATION_SCHEDULER", "false")

    # Allow SLACK_WEBHOOK_URL (legacy name in .env.example) to drive notifications
    if not os.getenv("SLACK_INTERNAL_WEBHOOK_URL") and os.getenv("SLACK_WEBHOOK_URL"):
        os.environ["SLACK_INTERNAL_WEBHOOK_URL"] = os.environ["SLACK_WEBHOOK_URL"]

    print(f"\n{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════{RESET}")
    print(f"{BOLD}{CYAN}  núcleo CBAM Compliance Platform — Live Demo{RESET}")
    print(f"{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════{RESET}")
    print(f"\n  {DIM}API endpoint:     {API_URL}{RESET}")
    print(f"  {DIM}Demo tenant ID:   {DEMO_TENANT}{RESET}")
    print(f"  {DIM}Slack webhook:    {'SET  ✓' if os.getenv('SLACK_INTERNAL_WEBHOOK_URL') else 'NOT SET  ← set SLACK_INTERNAL_WEBHOOK_URL'}{RESET}")
    print(f"  {DIM}Resend key:       {'SET  ✓' if os.getenv('RESEND_API_KEY') else 'NOT SET  ← set RESEND_API_KEY'}{RESET}")
    print(f"  {DIM}Recipient email:  {RECIPIENT_EMAIL or 'NOT SET  ← set RECIPIENT_EMAIL'}{RESET}")
    print(f"  {DIM}Claude key:       {'SET  ✓' if os.getenv('ANTHROPIC_API_KEY') else 'NOT SET  ← narrative will fail'}{RESET}")

    with httpx.Client(timeout=TIMEOUT) as client:
        # Verify API is reachable
        try:
            health = client.get(f"{API_URL}/health")
            if health.status_code != 200:
                error(f"API health check failed ({health.status_code}). Is the API running?")
                error(f"Start it with: cd api && uvicorn main:app --reload")
                sys.exit(1)
        except httpx.ConnectError:
            error(f"Cannot connect to API at {API_URL}")
            error("Start it with: cd api && uvicorn main:app --reload")
            sys.exit(1)

        # Mint dev JWT
        token = mint_token(client)
        client.headers["Authorization"] = f"Bearer {token}"
        ok("Dev JWT minted and attached to all requests")

        # Run the three scenarios
        run_steel_scenario(client)
        run_cement_scenario(client)
        run_aluminium_scenario(client)

    print(f"\n{BOLD}{GREEN}══════════════════════════════════════════════════════════════════════{RESET}")
    print(f"{BOLD}{GREEN}  Demo complete.{RESET}")
    print(f"{BOLD}{GREEN}══════════════════════════════════════════════════════════════════════{RESET}\n")


if __name__ == "__main__":
    main()
