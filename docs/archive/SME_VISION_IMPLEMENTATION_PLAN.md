# Arbor — SME Vision Implementation Plan

**Premise:** the engine (ingest → certify → store → share) is built. What's missing is
everything *between the database and the human* — the surfaces that make an SME upload
once and never think about a data request again.

**Framing (the door we enter through):**
> Arbor is where you keep the documents that prove your business does what it says —
> so you only ever answer the question once.

**Architecture rule that constrains every core below:** Arbor holds and *assembles*
certified data; it does not perform sustainability calculations. Pre-fill and exports
select, format, and unit-consistently assemble stored records with trust tiers attached.
They never apply emission factors or derive new metrics — that stays in the customer's tool.

---

## Build order (by leverage, not by dependency)

1. **Questionnaire pre-fill engine** — proves "answer once" viscerally.
2. **Signed shareable export** — closes "share without worrying."
3. **Broader document taxonomy (schema-on-read)** — opens beyond CBAM-shaped docs.
4. **Batched review digest** — makes the SME UX honest about "nothing to worry about."
5. **Email-forward inbound request handler** — converts "I got asked something" into an answer.

---

## Core 1 — Questionnaire pre-fill engine

**Goal:** select one questionnaire and pre-fill it end-to-end from stored records,
with a trust tier shown per answer.

### Design
- **Template model** (`src/lib/questionnaires/types.ts`): a `QuestionnaireTemplate` is an
  ordered list of `QuestionDefinition`s. Each question declares how it maps to stored data:
  - `mode: 'direct'` — one canonical stored record answers it (e.g. a carbon footprint
    report's `total_co2e`). Fill with that value + its tier.
  - `mode: 'assemble'` — many same-(domain, field, unit) records combine by transparent
    sum (e.g. four quarterly electricity bills → annual kWh). Labelled "Σ of N records".
    Never applies a factor or unit conversion that changes meaning.
  - `mode: 'collection'` — list contributing records for the customer's tool to combine
    (used where a real sustainability *calculation* would be required, e.g. kWh → tCO2e).
- **Pure pre-fill function** (`src/lib/questionnaires/prefill.ts`): `(template, records) →
  PrefilledAnswer[]`. No DB, no AI. Trust tier of an answer = the *worst* contributing tier
  (A→B→C). Missing data → `status: 'gap'`. **Tested first.**
- **Templates** (`src/lib/questionnaires/templates.ts`): start with **CDP Climate (core
  operational subset)** — it maps cleanly to stored operational data (energy, emissions,
  water, waste). Stub EcoVadis / Sedex / B-Corp / generic-supplier for later.
- **API** (Layer 3, read-only): `GET /api/questionnaires` (list), `GET
  /api/questionnaires/[template]/prefill?periodStart&periodEnd` (load records, run prefill).
- **UI**: `/questionnaires` (list), `/questionnaires/[template]` (pre-filled answers, tier
  per answer, gaps highlighted, export to CSV/JSON).

### Acceptance
- A CDP template with stored energy + emissions records returns pre-filled answers, each
  with a value, unit, trust tier, and source record ids.
- A question with no matching records returns `status: 'gap'`.
- `assemble` answers sum only identical-unit records and report the contributing count.
- An answer's tier equals the worst contributing record's tier.

---

## Core 2 — Signed shareable export

**Goal:** the SME shares a record set as a link; a buyer/auditor opens it, sees the
records + certification, and verifies the audit chain **without an Arbor account**.

### Design
- Reuse Gap-4 `packageIntegrityHash` + `/api/audit/verify-public`.
- New `SharedExport` model: `id`, `entityId`, `token` (unguessable), `domain?`,
  `periodStart?`, `periodEnd?`, `packageHash`, `createdById`, `expiresAt?`, `revokedAt?`.
- `POST /api/shares` (create, returns link), `DELETE /api/shares/[id]` (revoke), `GET
  /api/shares` (list mine).
- Public `GET /share/[token]` page — read-only record table + trust tiers + a
  "verify integrity" button hitting the public verify endpoint. No login.
- Logs each open in `RecordAccessLog` (method `EXPORT`).

### Acceptance
- Creating a share returns a public link; opening it shows the scoped records with tiers.
- The verify button confirms the package hash via `/api/audit/verify-public`.
- A revoked or expired share shows "no longer available", not the data.

---

## Core 3 — Broader document taxonomy (schema-on-read)

**Goal:** accept the long tail of SME documents (lease, payroll, lab report, insurance,
waste manifest, training record…) instead of rejecting unknown types.

### Design
- Add a `GENERIC` ingestion path: when the document type is unknown or `OTHER`, the
  extractor returns whatever key/value fields it finds (no fixed admissibility spec).
- Store generic fields as `ExtractedField`s with `admissibility = OPTIONAL`; tier defaults
  to **B (Declared)** because there is no spec to verify against.
- Add a best-guess `documentClass` string (free text from the model) so later queries can
  filter without a rigid enum.
- Records from generic docs are queryable like any other; questionnaire pre-fill can draw
  from them by `fieldName`.

### Acceptance
- Uploading an unrecognised document produces stored fields (not a rejection).
- The record is Tier B and carries the model's `documentClass` guess.
- A generic field is selectable by a questionnaire question that maps to its `fieldName`.

---

## Core 4 — Batched review digest

**Goal:** stop forcing the data-owner to confirm field 7 of a utility bill. Replace
per-document blocking review with a single periodic digest.

### Design
- Low-stakes path: fields below threshold on **non-critical** document types are
  auto-accepted as **Tier B** (Declared) instead of blocking, so a record exists
  immediately; the digest invites an upgrade.
- A weekly digest (extend the existing cron) emails each entity: "N fields need ~M
  minutes" linking to a single review queue.
- New `/review` page: every flagged field across all documents in one list, confirm/correct
  inline, bulk-confirm.
- Critical-flag document types (CBAM, customs, certificates) still block — they are
  high-stakes and must not be silently declared.

### Acceptance
- A low-stakes doc with a sub-threshold field writes a Tier B record without blocking.
- The `/review` page lists all flagged fields for the entity in one place.
- The weekly digest counts outstanding flagged fields and links to `/review`.
- Critical document types still route to per-document review.

---

## Core 5 — Email-forward inbound request handler

**Goal:** an external party emails a data request; the SME doesn't lift a finger.

### Design
- Reuse the Gap-8.4 inbound-email infrastructure (`/api/inbound-email`, provider webhook).
- A second recipient pattern `requests-<entityToken>@arbor.io` routes to a request, not an upload.
- New `InboundRequest` model: `id`, `entityId`, `fromEmail`, `rawText`, `parsedFields`
  (JSON), `status` (NEW / ANSWERED / NEEDS_DATA), `answeredAt`.
- `parse-inbound-request` Inngest function: Claude parses the email into
  {domain, fields, period}; matches against stored records; if covered, assembles an answer
  packet and replies; if not, marks `NEEDS_DATA` and surfaces to the SME.
- SME sees "we answered 14 requests this month" on the dashboard; only `NEEDS_DATA` items
  need attention.

### Acceptance
- An email to the requests address creates an `InboundRequest`.
- A request fully covered by stored records is auto-answered (status ANSWERED).
- A request with missing data is flagged NEEDS_DATA and shown to the SME.

---

## Cross-cutting rules
- TDD for all pure logic (prefill, taxonomy field-shaping, request parsing mappers).
- Every quantitative output carries its trust tier; provenance never stripped.
- No emission factors, no derived sustainability metrics — assembly and formatting only.
- Run `npm run build` (not just tsc/jest) before declaring any deploy-ready.
- SME-facing screens: plain English, one primary action, no modals, design-system tokens only.

**Document version:** 1.0
