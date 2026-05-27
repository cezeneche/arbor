# Arbor — Claude Code Instructions

## On every initialisation, read this file first:
`/Users/chisom/.claude/projects/-Users-chisom-Documents-Chisom-AI---Technology-arbor-arbor/memory/project_arbor_prd.md`

Then read the admissibility spec:
`/Users/chisom/.claude/projects/-Users-chisom-Documents-Chisom-AI---Technology-arbor-arbor/memory/project_arbor_admissibility.md`

Do not begin any task until you have read both files. If either file is unavailable, ask the user to re-paste the PRD before proceeding.

---

## What this project is

A sustainability data infrastructure platform. Manufacturers, suppliers, and producers upload operational documents. The platform extracts, certifies, and stores the data. **The database is the product.**

Every feature must either fill the database or make it more valuable. Features that do neither are not built.

---

## Architecture rules (non-negotiable)

- **Layer 1 — Extraction:** AI lives here only. Probabilistic. Always returns confidence score and source text. Fields below 0.85 confidence are flagged for human review — never silently accepted.
- **Layer 2 — Calculation:** Pure functions only. No DB reads. No API calls. No AI. No side effects. Same inputs always return same outputs. Every function carries a regulatory citation.
- **Layer 3 — Packaging:** Translation only. No calculation logic. Trust tier travels with every data point into the output.
- Never mix layers. If a function reads from the DB and also calculates, split it.

---

## Trust tier rules (non-negotiable)

- **Tier A:** All compulsory fields present per admissibility spec, read_type = ACTUAL (where applicable), confidence score ≥ 0.85, no unresolved critical flags.
- **Tier B:** Any compulsory field absent, read_type = ESTIMATED, or unresolved critical flag.
- **Tier C:** No document submitted. Published default factor applied. Source always cited.
- Tier is determined by applying the admissibility spec rules — not by user choice.
- Tier is always visible on every data record. It cannot be hidden in any output.

---

## Design rules (non-negotiable)

- All colour, spacing, and typography from `src/lib/design-system.ts` — no hardcoded hex values anywhere.
- Font weights: 300 and 500 only. No other weights.
- No modal dialogs — all confirmations are inline.
- No tabs — navigation is flat.
- Every screen has one clear primary action.

---

## Before writing any code

1. Identify which layer the work belongs to (Extraction / Calculation / Packaging).
2. Check the admissibility spec for the document type — use its compulsory/conditional/optional distinction, not a flat field list.
3. Write the test first — state the expected input, expected output, and reason (regulatory citation if applicable).
4. Run the test — confirm it fails.
5. Write the implementation.
6. Run the test — confirm it passes.

---

## Admissibility rules to enforce in code

When determining trust tier from an extraction result, apply these rules (from admissibility spec):
- If any **compulsory** field is absent → Tier B (critical flag)
- If any **conditional** field is absent when its condition is met → warning flag
- If read_type = ESTIMATED (electricity/gas bills) → Tier B regardless of other fields
- If commodity_code is 6-digit rather than 8-digit (customs/CBAM) → critical flag
- If certificate expiry_date is before the reporting period → critical flag
- If certificate_number duplicates an existing record → critical flag (double-counting)
- If CBAM declaration is Tier 1 or 2 and supporting_data_reference is absent → Tier B

---

## Deployment gate

- All tests pass — zero failures, zero skips.
- All `@regulatory` tagged tests pass with zero exceptions.
- No test has been commented out or marked skip to make the suite green.
- Layer 2 purity verified: no DB reads, no API calls in any calculation function.

---

## Key regulatory references

- EU Regulation 2023/1773 — CBAM embedded emissions calculation
- GHG Protocol Corporate Standard — Scope 1/2/3 methodology
- GHG Protocol Product Standard — product-level embedded emissions
- DEFRA Conversion Factors (current year) — UK emission factors
- IPCC AR6 — global warming potentials
