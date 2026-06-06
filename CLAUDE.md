# Arbor — Claude Code Instructions

## On every initialisation, read this file first:
`/Users/chisom/.claude/projects/-Users-chisom-Documents-Chisom-AI---Technology-arbor-arbor/memory/project_arbor_prd.md`

Then read the admissibility spec:
`/Users/chisom/.claude/projects/-Users-chisom-Documents-Chisom-AI---Technology-arbor-arbor/memory/project_arbor_admissibility.md`

Do not begin any task until you have read both files. If either file is unavailable, ask the user to re-paste the PRD before proceeding.

---

## What this project is

A certified operational data repository. Manufacturers, suppliers, and producers upload operational documents. The platform extracts, certifies, and stores the data. **The database is the product.**

Arbor does not perform sustainability calculations. It does not produce CBAM returns, Scope 3 inventories, or ESG disclosures. It holds the verified operational data that those calculations require. The calculations happen in the customer's tools. Arbor is the data source, not the processing engine.

Every feature must either fill the database, improve the quality of existing records, or make the database more accessible to legitimate users. Features that do none of these are not built.

---

## Architecture rules (non-negotiable)

- **Layer 1 — Ingestion:** AI lives here only. Probabilistic. Always returns confidence score and source text. Fields below 0.85 confidence are flagged for human review — never silently accepted. No record is written to the database until the user has confirmed or corrected flagged fields.
- **Layer 2 — Storage and Certification:** Every confirmed record is written with the full entity model. HMAC audit chain is computed and linked at write time. Records are never overwritten — corrections create new records that supersede the original. Trust tier is assigned at write time and cannot be changed without creating a new record. Unit normalisation to SI base unit happens here.
- **Layer 3 — Access and Sharing:** Read-only. Query engine, unit conversion on output, and export formatting. No modification of stored data. No calculation logic. Trust tier and plain English certification label travel with every data point in every output.
- Never mix layers. If a function reads from the DB and also transforms data, it belongs in Layer 3. If it writes to the DB, it belongs in Layer 2. If it uses AI, it belongs in Layer 1.

---

## Trust tier rules (non-negotiable)

- **Tier A (Verified):** Extracted from a submitted source document. Source text recorded. Document passed all quality checks. Confidence score ≥ 0.85, or field manually confirmed by the user.
- **Tier B (Declared):** Entered directly by the user without an attached supporting document, or the submitted document failed one or more quality checks that did not prevent submission.
- **Tier C (Estimated):** No company-specific data available. A published default reference value has been applied. Source always cited. Never presented as actual activity data.
- Tier is determined by applying the admissibility spec rules — not by user choice.
- Tier is always visible on every data record. It cannot be hidden in any output.
- User-facing labels are: **Verified** (Tier A), **Declared** (Tier B), **Estimated** (Tier C).

---

## Design rules (non-negotiable)

- All colour, spacing, and typography from `src/lib/design-system.ts` — no hardcoded hex values anywhere.
- Font weights: 300 and 500 only. No other weights.
- No modal dialogs — all confirmations are inline.
- No tabs — navigation is flat.
- Every screen has one clear primary action.
- SME supplier-facing screens show only plain English. No domain codes, tier codes, or technical detail unless the user specifically requests it.
- Buyer-facing screens show full technical detail — trust tiers, confidence scores, source text, domain classification.

---

## Before writing any code

1. Identify which layer the work belongs to (Ingestion / Storage+Certification / Access+Sharing).
2. Check the admissibility spec for the document type — use its compulsory/conditional/optional distinction, not a flat field list.
3. Write the test first — state the expected input, expected output, and reason.
4. Run the test — confirm it fails.
5. Write the implementation.
6. Run the test — confirm it passes.

---

## Admissibility rules to enforce in code

When determining trust tier from an extraction result, apply these rules (from admissibility spec):
- If any **compulsory** field is absent → Tier B (critical flag)
- If any **conditional** field is absent when its condition is met → warning flag
- If commodity_code is 6-digit rather than 8-digit (customs declarations) → critical flag
- If certificate expiry_date is before the reporting period → critical flag
- If certificate_number duplicates an existing record → critical flag (double-counting)

---

## Deployment gate

- All tests pass — zero failures, zero skips.
- No test has been commented out or marked skip to make the suite green.
- No calculation logic in Layer 3 — it translates and formats, nothing more.
- No AI calls in Layer 2 or Layer 3.
- No DB reads or writes in Layer 1.

---

## Key references

- Admissibility spec — compulsory/conditional/optional field definitions for every accepted document type
- PRD Section 10 — mandatory attributes for every DataRecord written to the database
- PRD Section 14 — unit conversion supported dimensions and constraints
- PRD Section 12 — trust tier determination and upgrade pathway rules
