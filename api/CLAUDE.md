# CLAUDE.md — Nucleos Compliance Platform
## Standing Brief for Claude Code
### Last updated: March 2026

This file is read by Claude Code before any task in this repository.
Do not modify this file without updating the regulatory references.

---

## What This Codebase Is

Nucleos is a CBAM (Carbon Border Adjustment Mechanism) compliance platform.
It processes supplier documents into legally defensible tax returns for UK and EU
carbon border regulations. Errors in this codebase can cause customers to file
incorrect tax returns, face financial penalties, and lose market access.

Treat every calculation function as tax-critical infrastructure.
Treat every output as a document that may be audited by HMRC or the EU
Commission years after it was generated.

---

## The Two Regimes This Platform Serves

### UK CBAM (Finance No.2 Bill 2025-26)
- Live from: 1 January 2027
- Administered by: HMRC via Government Gateway
- Output format: Tax return (not certificate mechanism)
- Registration threshold: £50,000 of CBAM goods in rolling 12-month window
- First return period: 1 Jan 2027 – 31 Dec 2027
- First return due: 31 May 2028
- From 2028: quarterly returns, due 2 months after quarter end
- Sectors: steel, aluminium, cement, fertilisers, hydrogen
- Indirect emissions: NOT included until 2029 at earliest
- Record retention: 6 years
- Penalties: mirror VAT penalty framework; criminal offence for fraudulent evasion

### EU CBAM (Regulation EU 2023/956, amended by EU 2025/2083)
- Live from: 1 January 2026 (financial phase)
- Administered by: EU CBAM Registry (national competent authorities)
- Output format: XML declaration + certificate purchase
- Registration threshold: 50 tonnes/year net mass
- Sectors: steel, aluminium, cement, fertilisers, hydrogen, electricity
- Indirect emissions: included for cement and fertilisers
- Record retention: 4 years (CBAM registry)
- Default value mark-ups: 10% (2026), 20% (2027), 30% (2028+)

---

## Critical Calculation Rules — Never Break These

### Rule 1: UK and EU are different calculations
When jurisdiction = "UK":
- Use HMRC-published CBAM rate (not raw ETS price)
- CBAM rate = UK_ETS_price × (1 - free_allocation_factor_for_sector)
- Include ONLY direct emissions (Scope 1)
- DO NOT include indirect emissions (electricity) until jurisdiction_indirect_date >= 2029
- EXCLUDE emissions from UK-produced precursor goods

When jurisdiction = "EU":
- Use EU ETS quarterly average certificate price (2026) or weekly average (2027+)
- Include direct emissions for all sectors
- Include indirect emissions for cement and fertilisers
- Apply free allocation phase-in factor (97.5% in 2026, declining to 0% by 2034)
- UK-produced precursor exclusion does NOT apply

### Rule 2: The three-tier methodology must be applied in order
Always attempt Tier 1 before Tier 2, Tier 2 before Tier 3.
Never skip a tier without recording the reason in the decision trace.

Tier 1 (actual): supplier-provided verified data, confidence >= 0.60
  SEE = reported_kgCO2e / (net_mass_kg / 1000)
  Plausibility check: flag if > 10x Annex VI default (extreme_outlier)
  Plausibility check: flag if > 20% above Annex VI default (high_deviation)

Tier 2 (estimated): supplier data present but confidence < 0.60
  Use value but flag as estimated, record confidence and reason

Tier 3 (default): no supplier data or Tier 1/2 failed
  Lookup from cbam_emission_factors by (cn8_prefix, production_route, table_version)
  If production_route is null, use world-average route-agnostic row
  Apply UK or EU default value mark-up for the relevant year

### Rule 3: Every calculation must produce a complete decision trace
Every method selection must record:
- selected_method: "actual" | "estimated" | "default"
- rejection_reason for each higher tier that was rejected
- confidence_scores for all extracted values used
- annex_vi_factor_version used (never assume — always record)
- regulation_reference: e.g. "EU 2023/1773 Art. 4(1)(a)"

No calculation output is valid without a complete decision trace.

### Rule 4: Default values are versioned — never update, always insert
When default values change (new Annex VI publication, HMRC update):
- INSERT new rows with incremented table_version
- NEVER UPDATE existing rows
- Every historical emission record must retain a foreign key to the exact
  table_version used at calculation time

### Rule 5: The audit chain must be maintained
Every processing stage produces a named, HMAC-signed snapshot:
  extraction_v1 → arbitrated_v1 → repaired_v1 → report_package_v1 → compliance_pack_v1

The HMAC chain is verified on every read.
If any snapshot in the chain is missing or its hash does not match, the chain
is broken and human review is required before any output is generated.

### Rule 6: AI extraction cannot influence calculation logic
The extraction layer (regex + Claude gap-fill) produces structured data.
The calculation engine consumes that data.
These are separate systems. No LLM output enters the calculation engine
without passing through the arbiter and repair validation layers first.

Claude gap-fill values must:
- Return JSON only
- Mark absent fields as null, never invent values
- Only be accepted if the value appears literally in the source document text

### Rule 7: Carbon Price Relief requires GACI-accredited verification
CPR claims reduce CBAM liability. They require:
- Independent verification by a GACI-accredited body
- Meeting ISO 17029, ISO 14064-3, ISO 14065, ISO 14066
- A completed carbon pricing verification form stored in the audit chain
- Currency conversion to GBP with the exchange rate date recorded
- CPR cannot exceed the CBAM charge for that goods line (cannot go below zero)

---

## Sectors, Greenhouse Gases, and Indirect Emissions Rules

| Sector | Direct GHG | Indirect GHG | EU indirect | UK indirect |
|--------|-----------|--------------|-------------|-------------|
| Iron & steel | CO2 | CO2 (electricity) | Report only | Not required |
| Aluminium | CO2, PFCs | CO2 (electricity) | Report only | Not required |
| Cement | CO2 | CO2 (electricity) | Included in charge | Not required |
| Fertilisers | CO2, N2O | CO2 (electricity) | Included in charge | Not required |
| Hydrogen | CO2 | CO2 (electricity) | Report only | Not required |
| Electricity | CO2 | N/A | In scope (EU only) | Not in scope |

PFCs = perfluorocarbons (aluminium only)
N2O = nitrous oxide (fertilisers only, 298x CO2 warming potential)

---

## Production Routes — These Affect Default Values

Steel:
- BF-BOF: Blast Furnace – Basic Oxygen Furnace (highest emissions, ~1.8-2.2 tCO2/t)
- EAF: Electric Arc Furnace (scrap-based, ~0.3-0.6 tCO2/t direct)
- DRI-EAF: Direct Reduced Iron + EAF (emerging lower-carbon)
- world_average: use when route unknown

Aluminium:
- primary_electrolysis: from bauxite ore (electricity-intensive)
- secondary_remelt: from recycled scrap (very low direct emissions)
- world_average: use when route unknown

Cement:
- clinker_production: wet or dry process (differentiate by clinker content %)
- blended_cement: lower clinker content = lower emissions intensity
- world_average: use when route unknown

Fertilisers:
- haber_bosch_smr: steam methane reforming (most common, highest emissions)
- haber_bosch_electrolysis: green hydrogen route (near zero direct)
- world_average: use when route unknown

Hydrogen:
- smr_without_ccs: grey hydrogen (~9-12 tCO2/t H2)
- smr_with_ccs: blue hydrogen (~2-4 tCO2/t H2)
- electrolysis_renewable: green hydrogen (~0 tCO2/t H2)
- world_average: use when route unknown

---

## What Must Be Reported on the UK HMRC Return

Per consignment (one row per customs entry):
- consignment_reference: customs entry number
- import_date: date goods released into free circulation
- origin_country: ISO 3166-1 alpha-2

Per goods line within each consignment:
- cn8_code: 8-digit combined nomenclature code
- net_weight_kg: net weight excluding packaging
- emissions_method: "actual_verified" | "actual_unverified" | "default"
- direct_embedded_tco2e: total direct emissions
- cbam_rate_gbp_per_tco2e: published quarterly CBAM rate for the sector
- cbam_charge_gbp: direct_embedded_tco2e × cbam_rate
- cpr_gbp: Carbon Price Relief (0.00 if not claimed)
- cbam_liability_gbp: cbam_charge - cpr (cannot be negative)
- verification_reference: verifier name + accreditation (required if actual_verified)

Return header:
- importer_eori
- importer_vat_number
- return_period_start / return_period_end
- total_cbam_liability_gbp
- accuracy_declaration: must be True

---

## What Must Be Reported on the EU CBAM Declaration

Per goods line:
- CombinedNomenclatureCode: cn8_code
- ImporterEORINumber
- NetMass: in tonnes (not kg — convert)
- DirectEmbeddedEmissions: tCO2e
- IndirectEmbeddedEmissions: tCO2e (cement and fertilisers only)
- EmissionsCalculationMethod: "ACTUAL" | "ESTIMATED" | "DEFAULT"
- DataSourceInformation: includes factor_table_version
- CarbonPricePaidThirdCountry: EUR value (if deduction claimed)

---

## Tech Stack

Language: Python 3.11+
Framework: FastAPI (single application, not microservices)
Database: Supabase (PostgreSQL with RLS)
Storage: Supabase Storage (document blobs)
LLM: Anthropic Claude only (single call for narrative generation)
Validation: Python assertion layer (no LLM for numeric validation)
Auth: JWT (HS256 dev, OIDC production)
Payments: Stripe
Notifications: Slack webhook (internal), Resend (customer email)

## What Is NOT in This Stack
- No OpenAI
- No Google Gemini
- No n8n
- No Redis
- No ARQ job queue
- No Prometheus (use Grafana Cloud free tier)
- No MinIO (use Supabase Storage)
- No async job workers (use FastAPI BackgroundTasks for fire-and-forget)
- No circuit breaker libraries (use try/except with clear error responses)

---

## Database Rules

Tenant isolation: enforced via PostgreSQL RLS
  Policy pattern: USING (tenant_id = current_setting('app.current_tenant_id'))
  Session variable set in FastAPI middleware before every request
  Use pooled Supabase connection port (6543) not direct (5432)

Versioning pattern:
  Emissions factors: (cn8_prefix, production_route, table_version) composite key
  Never UPDATE factor rows — INSERT new rows with incremented version
  Historical emission records retain factor_table_version FK

Snapshots:
  Append-only — never UPDATE cbam_snapshots rows
  Each snapshot carries parent_hash linking to predecessor
  Chain: extraction_v1 → arbitrated_v1 → repaired_v1 → report_package_v1 → compliance_pack_v1

Audit log:
  Append-only — never UPDATE audit_log rows
  HMAC-chained: each event carries prev_hmac linking to previous event
  Chain verified on every read

---

## Reconciliation Checks — Run Before Every Report Output

1. Mass consistency: net_weight across invoice and customs declaration must match
2. SEE range plausibility: supplier SEE vs Annex VI default
   - > 10x default → extreme_outlier → downgrade to Tier 2
   - > 20% above default → high_deviation warning
3. Unit normalisation: detect and correct kgCO2e vs tCO2e vs kgCO2e/t confusion
4. Quarterly totals: sum of goods-line emissions must equal declared total
5. CN code scope: every CN code must map to a valid CBAM sector
6. HMAC chain: verify chain integrity on every report package assembly
7. Verification status: if method = actual_verified, verification_status must = "verified"
8. CPR cap: cpr_gbp cannot exceed cbam_charge_gbp

If any blocking check fails:
  Set human_review_required = True
  Do not generate the compliance pack
  Surface all failures in open_gaps with plain English descriptions

---

## The Narrative Engine

Claude generates the compliance narrative ONLY — not calculations.
The narrative is an audit support document, not a regulatory submission.

Claude's role:
- Write executive_summary (plain English, what was calculated)
- Write methodology (which tier, which regulation, why)
- Write limitations (human-readable version of all warnings and repair_failed items)
- Populate open_gaps (what the importer needs to do before submission)

Claude must NEVER:
- Compute or modify any numeric value
- Change results{} — these are always overridden with report_package values after the call
- Invent data that is not in the report package

Temperature: 0.0 (deterministic)
Return: valid JSON only, no markdown fencing

---

## Qualifying Countries for Carbon Price Relief

Currently NO countries are confirmed exempt from UK CBAM.
UK-EU ETS linking is under active discussion but not confirmed as of March 2026.

EU CBAM exemptions (recognised ETS links):
- Norway, Iceland, Liechtenstein (EEA ETS)
- Switzerland (linked ETS)

For any other country: CPR may be claimable if the country has a qualifying
explicit carbon pricing scheme, but requires GACI-accredited verification.
Implicit carbon pricing (e.g. fuel taxes) does NOT qualify.

---

## Scope Expansion — Build Modularly

Current scope (2027):
- UK: steel, aluminium, cement, fertilisers, hydrogen
- EU: steel, aluminium, cement, fertilisers, hydrogen, electricity

Coming soon:
- UK: indirect emissions (2029+), glass, ceramics (future review)
- EU: 180 downstream steel/aluminium products (proposed Dec 2025)
- Both: all EU ETS sectors by 2030

Every sector must be a self-contained module.
Adding a new sector must require: new CN codes in scope table,
new emission factors in cbam_emission_factors, new production routes.
It must NOT require changes to the calculation engine core logic.

---

## Testing Requirements

Every regulatory rule must have a corresponding test.
The test suite is the regulatory knowledge base.

Required test categories:
1. Three-tier method selection — all paths through the decision tree
2. Plausibility checks — extreme_outlier and high_deviation boundaries
3. Unit conversion — kgCO2e, tCO2e, kgCO2e/t all normalise correctly
4. CPR calculation — correct formula, GBP conversion, cap enforcement
5. Audit chain integrity — tampering breaks chain, valid chain passes
6. Tenant isolation — Tenant B cannot read Tenant A's data (real DB, not mocks)
7. HMRC return format — all required fields present, units correct
8. EU XML format — schema compliance, correct field mapping
9. Jurisdiction rules — UK excludes indirect, EU includes for cement/fertilisers
10. Precursor exclusion — UK-produced precursors correctly excluded from UK CBAM

When adding a new feature, write the test before writing the implementation.
If a regulatory rule does not have a test, it is not implemented — it is aspirational.

---

## What Good Looks Like

A correct Nucleos output is one where:
- Every emission value is traceable to its source document and extraction method
- Every method selection is traceable to a regulatory provision
- Every calculation can be reproduced from the stored inputs
- The HMAC chain is unbroken from document upload to compliance pack
- A regulator auditing the declaration in 2032 can reconstruct exactly what
  happened in 2027 without any ambiguity

A correct Nucleos output is NOT one that:
- Produces a number that looks reasonable
- Passes without errors
- Generates a PDF that looks professional

Correctness is regulatory defensibility, not technical correctness.
