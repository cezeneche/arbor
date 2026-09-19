# Arbor — Gap Implementation Plan v1.1

**Companion to:** `IMPLEMENTATION_PLAN.md` (foundation build sprints)  
**Covers:** The nine gaps identified in the June 2026 stack review, plus SSO/SAML  
**Rule:** Every gap maps to a phase. Every task has an acceptance criterion. Nothing is excluded because it is hard.

---

## What is already built (relevant to this plan)

| Gap area | What exists |
|---|---|
| Supplier onboarding | `/submit/[token]` buyer-initiated flow, signup page |
| Buyer consumption | Supply chain page, query engine, export builder, `/api/v1/records`, `/api/v1/documents` |
| Multi-tenant consent | `DataAccessGrant` model, `/access` page with grant/revoke |
| Verifier integration | Audit package generation (`/api/audit-package`), chain verify (`/api/audit/[entityId]/verify`) |
| Document expiry | `check-certificate-expiry.ts` Inngest cron runs daily, flags expired/expiring `ExtractedField` records |
| OCR / multilingual | Claude vision used for images; no multilingual preprocessing |
| ERP integrations | `/api/v1/ingest` accepts bulk records via API key with idempotency |
| Audit mode | Chain verify endpoint exists but requires entity session auth; no external auditor UI |
| Compliance posture | DPA, privacy, and terms as static marketing pages |

---

## Phase sequence

```
Phase A — Data integrity (no dependencies; build first)
  Gap 1  OCR / multilingual / degraded documents
  Gap 2  Document expiry and staleness UX
  Gap 7a Security headers and rate limit audit (quick wins, do in parallel)

Phase B — Trust and regulatory readiness
  Gap 3  Verifier integration
  Gap 4  Audit mode for external auditors
  Gap 7b Full compliance posture — DPA, security page, SOC 2 Type I completion

Phase C — Data sharing mechanics
  Gap 5  Multi-tenant identity and consent
  Gap 6  Buyer API and webhooks

Phase D — Growth and integrations
  Gap 8  Supplier onboarding improvements
  Gap 10 SSO / SAML
  Gap 9  ERP and customs system connectors (SAP, NetSuite, CDS)
```

---

## Gap 1 — OCR, Multilingual, and Degraded Documents

**Priority: Critical.** Affects data quality at the core of the product. Most real supplier documents from CBAM-adjacent sectors are non-English or scanned paper.

### 1.1 Language detection

Add a lightweight pre-call before full extraction. In `src/lib/extraction/engine.ts`, before the main extraction call, send a one-sentence prompt:

> "What language is this document written in? Respond with the ISO 639-1 language code only (e.g. 'en', 'de', 'fr', 'zh'). No other text."

Store the result as `detectedLanguage` on `ExtractionJob`. If the call fails or returns an unrecognised code, default to `'unknown'` and continue — language detection failure is not a reason to halt extraction.

**Schema change:** `ExtractionJob.detectedLanguage String?`

### 1.2 Multilingual extraction prompt

In `src/lib/extraction/prompts.ts`, extend `buildExtractionPrompt` to accept a `detectedLanguage` parameter. When language is not `en`:

- Prepend to the prompt: "This document is written in [language]. Extract all field values exactly as they appear in the source document. Do not translate values. Translate field names to English only."
- Add a `languageNote` field to `ExtractionResult` so the review UI can show: "This document appears to be in German. Numeric values have been extracted as written — verify units carefully."

### 1.3 Image quality pre-assessment

Add a second pre-call that runs only when `mediaType` is `image/jpeg` or `image/png` (not PDF):

> "Rate the quality of this document image on a scale of 1 to 5, where 1 = unreadable, 3 = legible with effort, 5 = clear. Return a JSON object: { \"quality\": <number>, \"issues\": [\"blurry\", \"rotated\", \"low_contrast\", etc.] }"

Rules:
- Quality < 2: set document status to `REVIEW_REQUIRED`, write an `ExtractionJob` with status `FAILED` and `errorMessage` = "Image quality too low for reliable extraction. Upload a clearer version." Do not run full extraction.
- Quality 2–3: run full extraction but surface a warning banner in the review UI above the field list.
- Quality ≥ 4: proceed silently.

**Schema change:** `ExtractionJob.imageQualityScore Float?`, `ExtractionJob.imageQualityIssues Json?`

### 1.4 Confidence calibration for non-English and degraded

In `src/lib/extraction/admissibility.ts`, after computing flags, apply a calibration pass before threshold checks:

- If `detectedLanguage` is not `en` and not `null`: subtract `0.05` from all AI-extracted field confidence scores before threshold comparison. Rationale: Claude is systematically more confident on English documents; the penalty corrects for documented overconfidence on foreign-language text.
- If `imageQualityScore` is present and below `4.0`: subtract a further `0.05`.
- Penalties are applied only for threshold comparison — the stored `confidenceScore` on `ExtractedField` is the raw AI-reported score. A separate `adjustedConfidenceScore` column is not needed; the threshold check uses the adjusted value in memory only.

Document this logic with a single comment explaining why (not obvious to a future reader).

### 1.5 Review UI surface

In `src/app/(portal)/upload/[id]/review/page.tsx`:
- Show a dismissible banner if `detectedLanguage !== 'en'`: "This document appears to be in [language]. Values are shown as extracted. Check numeric fields and units carefully."
- Show a separate dismissible banner if `imageQualityScore < 4`: "This image was flagged as [Poor/Fair] quality. Some values may have been misread."
- Both banners use `colours.amberBg` / `colours.amber` from the design system.

### Acceptance criteria

- A German electricity bill produces `detectedLanguage = 'de'` and `languageNote` set on `ExtractionResult`
- A blurry scanned invoice scoring quality 2 shows the warning banner before the field list
- An image scoring quality 1 is rejected before full extraction runs
- The confidence penalty causes a non-English field at raw confidence 0.88 to fail the 0.85 threshold after adjustment, triggering a flag

---

## Gap 2 — Document Expiry and Record Staleness UX

**Priority: High.** The backend cron logic exists. None of it is visible to users.

### 2.1 Expiry notification emails

The `check-certificate-expiry.ts` cron currently only sets `flagReason` on `ExtractedField`. Extend it to also call `sendNotification` per entity for each batch of expiring/expired items found.

New `NotificationType` values: `CERTIFICATE_EXPIRING`, `CERTIFICATE_EXPIRED`

Email copy (plain English, no jargon):
- Expiring: "Your [certificate type] expires in [X] days. Upload a renewal to keep this record Verified."
- Expired: "Your [certificate type] expired on [date]. This record has been downgraded to Declared. Upload a renewal to restore Verified status."

Group by entity — one email per entity per cron run, not one per certificate.

### 2.2 Dashboard staleness panel

In `src/app/(portal)/dashboard/page.tsx`, add a "Needs attention" section rendered above the domain grid. It appears only when there is something to show — never show an empty section.

Query: `DataRecord` where `isActive = true`, related `Document` has an `ExtractedField` with `fieldName = 'expiry_date'` and `flagged = true`.

Each row, plain English:
> "Your ISO 14001 certificate expires 15 Jul 2026 — upload a renewal to keep this record Verified."

One action per row: "Upload renewal →" — routes to `/upload` with a pre-set document type passed as a query param.

Design: amber left border, `colours.amberBg` background, `colours.amber` text. Font weight 300 body, 500 for the certificate name and date.

### 2.3 Batch and mill certificate staleness

Production logs, material intake records, and delivery notes do not have an `expiry_date` field. They are valid only for their covered period. Add a `staleAfterDate DateTime?` field to `DataRecord`.

At write time in `src/lib/layer2/record-writer.ts`, when `documentType` is `PRODUCTION_LOG`, `MATERIAL_INTAKE`, or `DELIVERY_NOTE`: set `staleAfterDate = periodEnd + 90 days`. The 90-day constant is defined in `src/lib/constants.ts` as `BATCH_RECORD_STALE_DAYS = 90`.

Extend the existing cron to also check `DataRecord.staleAfterDate < today` and flag accordingly. Use the same `CERTIFICATE_EXPIRING` / `CERTIFICATE_EXPIRED` notification types — the email copy already covers both ("Your [record type] for [period]…").

**Schema change:** `DataRecord.staleAfterDate DateTime?`

### 2.4 Buyer supply chain staleness view

In `src/app/(portal)/supply-chain/page.tsx`, add a staleness column to the supplier table. Per supplier: count of active records with expiry or staleness flags, shown as an amber chip ("3 expiring"). Zero count: no chip shown.

Add a filter control above the table: "Show only suppliers with expiring records." Uses the existing `FilterBar` component pattern.

### Acceptance criteria

- A certificate expiring in 25 days triggers an email to the entity's users and appears in the dashboard attention panel
- A production log `DataRecord` has `staleAfterDate` set to `periodEnd + 90 days` at creation time
- Buyer supply chain page shows per-supplier expiry count
- An entity with no expiring records sees no attention panel section

---

## Gap 3 — Verifier Integration

**Priority: High.** Without a verifier sign-off flow, Tier A has no independent confirmation path for regulatory use. The audit package exists but has nowhere to land.

### 3.1 Verifier user role

Add `VERIFIER` to the `UserRole` enum (migration required).

Rules:
- Verifier accounts are created by platform admins only, not via public signup
- A verifier is not attached to any `Entity` — `entityId` is nullable for VERIFIER role users
- Middleware redirects VERIFIER users to `/verifier/assignments`, not `/dashboard`

**Schema change:** `UserRole` enum + `VERIFIER`; `User.entityId` becomes nullable (`String?`)

Note: making `entityId` nullable is a breaking change — audit every query that assumes `entityId` is always present and add a null guard or scope the nullable path to VERIFIER/AUDITOR roles only.

### 3.2 VerificationAssignment model

New model:

```
VerificationAssignment
  id                String
  entityId          String           — the entity being verified
  entity            Entity
  verifierId        String           — User with VERIFIER role
  verifier          User
  periodStart       DateTime
  periodEnd         DateTime
  assignedAt        DateTime
  status            VerificationStatus (PENDING / IN_REVIEW / VERIFIED / REJECTED)
  verifierNote      String?          @db.Text
  verifiedAt        DateTime?
  signatureHash     String?          — HMAC of package contents + verifierId + timestamp
```

New enum: `VerificationStatus`

### 3.3 Verifier portal

New route group: `src/app/(verifier)/`

Middleware must enforce `role === VERIFIER` for this route group.

Pages:
- `/verifier/assignments` — paginated list of assignments for the logged-in verifier, grouped by status (PENDING / IN_REVIEW / VERIFIED / REJECTED). Each row: entity name, period, assigned date, status chip.
- `/verifier/assignments/[id]` — the audit package view for a specific assignment. Renders the same content as the generated audit package: all records for the entity+period, source document index, confidence scores, source text, trust tiers, and the full audit chain. Read-only. Two actions at the bottom: "Verify" and "Reject with note". No inline editing. No modification of any record.

### 3.4 Verification completion

When a verifier clicks Verify:
1. Fetch all `DataRecord` IDs for the entity+period
2. Compute `signatureHash` = HMAC-SHA256(`entityId + periodStart + periodEnd + verifierId + verifiedAt`, `AUDIT_CHAIN_SECRET`)
3. Write a new `AuditEntry` with `eventType: 'VERIFIED_BY_THIRD_PARTY'` and the signature hash in the payload
4. Update `VerificationAssignment.status = VERIFIED`, set `verifiedAt` and `signatureHash`
5. Send a notification to the entity with `NotificationType.TIER_UPGRADED` — copy: "Your data for [period] has been independently verified."

When a verifier clicks Reject:
1. Require a non-empty rejection note
2. Update `VerificationAssignment.status = REJECTED`, store `verifierNote`
3. Write an `AuditEntry` with `eventType: 'VERIFICATION_REJECTED'` and the note in the payload
4. Notify the entity

### 3.5 Verification status in exports

Modify `src/lib/audit-package/generator.ts` to check for a completed `VerificationAssignment` for the entity+period. If one exists with `status = VERIFIED`:
- Include a `verification` object in the package: `{ verifierName, verifiedAt, signatureHash, status: 'INDEPENDENTLY_VERIFIED' }`

When a buyer exports records via `/api/query/export` or downloads from the supply chain view, and those records fall within a verified period, add the same `verification` block to each record in the export.

### 3.6 Admin assignment UI

In a new admin section (or extend the existing settings for admin users), allow creation of `VerificationAssignment` records: select entity by name, select period, select verifier by email. A confirmation step shows what will be shared with the verifier before creating the record.

### Acceptance criteria

- A VERIFIER-role user is redirected to `/verifier/assignments` on login, cannot access `/dashboard`
- Clicking Verify writes an `AuditEntry` and sets `signatureHash` on the assignment
- An audit package for a verified entity+period includes the verifier name, `verifiedAt`, and `signatureHash`
- A record export from a verified period includes the verification block
- Clicking Reject with a note stores the note and fires a notification to the entity

---

## Gap 4 — Audit Mode for External Auditors

**Priority: Medium-high.** The cryptographic guarantee exists. There is no way for an external auditor to exercise it independently.

### 4.1 AuditPackageLog model

Every time an audit package is generated, log it:

```
AuditPackageLog
  id            String
  entityId      String
  periodStart   DateTime
  periodEnd     DateTime
  generatedAt   DateTime
  packageHash   String   — HMAC of serialised package contents
  requestedById String
```

Modify `src/lib/audit-package/generator.ts` to compute `packageHash` as HMAC-SHA256 of the JSON-serialised package and write this log entry at generation time. Include the `packageHash` inside the generated package itself (top-level field: `packageIntegrityHash`).

### 4.2 Public chain verification endpoint

New API route: `GET /api/audit/verify-public`

Query params: `packageHash` (string), `entityId` (string)

No authentication required.

Logic: look up `AuditPackageLog` where `entityId = params.entityId AND packageHash = params.packageHash`. If found, run `verifyChain` for the entity and return:

```json
{ "verified": true, "entryCount": 142, "verifiedAt": "2026-06-19T10:00:00Z", "packageGeneratedAt": "2026-06-15T09:30:00Z" }
```

If not found, return `{ "verified": false, "reason": "Package hash not recognised" }` with status 200 (not 404 — the endpoint must not reveal whether an entityId exists to unauthenticated callers via timing or status code differences).

Rate limit: 10 requests per minute per IP.

### 4.3 Auditor user role and access

Add `AUDITOR` to `UserRole` enum.

New model:

```
AuditorAccess
  id            String
  auditorUserId String    — User with AUDITOR role
  entityId      String
  entity        Entity
  periodStart   DateTime
  periodEnd     DateTime
  grantedAt     DateTime
  expiresAt     DateTime  — access expires; auditor cannot view stale packages indefinitely
```

An AUDITOR-role user with a valid non-expired `AuditorAccess` record can:
- Call `GET /api/audit/[entityId]/verify` for their scoped entity
- Access a read-only page `/auditor/[entityId]` that renders the same view as `/verifier/assignments/[id]` but without the Verify/Reject actions

Middleware enforces: AUDITOR accessing `/auditor/[entityId]` must have an `AuditorAccess` record for that `entityId` that is not expired.

### 4.4 Verification instructions in generated package

The audit package generator adds a `verificationInstructions` field to every generated package:

```json
{
  "verificationInstructions": {
    "description": "To independently verify this package, send a GET request to the URL below with the packageIntegrityHash.",
    "endpoint": "https://app.arbor.io/api/audit/verify-public",
    "params": { "packageHash": "<packageIntegrityHash>", "entityId": "<entityId>" },
    "expectedResponse": { "verified": true }
  }
}
```

This means any auditor receiving the package file has everything they need to verify it without an Arbor account.

**Schema changes:** New `AuditPackageLog`, `AuditorAccess` models; `UserRole` + `AUDITOR`

### Acceptance criteria

- `GET /api/audit/verify-public?packageHash=X&entityId=Y` returns `verified: true` for a valid hash without authentication
- Passing a tampered or fabricated hash returns `verified: false`
- An AUDITOR user cannot access `/auditor/[entityId]` for an entity they have no `AuditorAccess` for
- The generated audit package JSON includes `packageIntegrityHash` and `verificationInstructions`
- `AuditPackageLog` has a row for every generated package

---

## Gap 5 — Multi-Tenant Identity and Consent

**Priority: Medium.** The 1:1 grant model is structurally correct. N:N mechanics, notification cascades, and legal consent recording are missing.

### 5.1 Supplier "who can see my data" view

Restructure `src/app/(portal)/access/page.tsx` to group by buyer entity rather than individual grants. Current view lists grants as rows. New view:

Each buyer as a card:
- Company name (plain English, not entity ID)
- Domains accessible, periods covered
- Granted date, plain English: "Granted 3 weeks ago"
- One "Revoke all access" button per buyer — revokes all active grants for that buyer in a single action

When a supplier has no active grants, show: "You haven't shared your data with anyone yet. When a buyer requests access, you'll see them here."

### 5.2 RecordAccessLog model

New model (Layer 3 — read-only, no modification):

```
RecordAccessLog
  id              String
  recordId        String
  dataRecord      DataRecord
  granteeEntityId String
  accessedAt      DateTime
  accessMethod    AccessMethod (API / PORTAL / EXPORT)
```

Write an entry in `RecordAccessLog` on:
- Every `GET /api/v1/supply-chain/[supplierId]/records` call (API)
- Every render of `/supply-chain/[supplierId]/records` page (PORTAL) — write on page load server action
- Every call to `/api/query/export` (EXPORT)

The supplier can view per-record access history in an expandable row on the records page: "This record was viewed by [Company X] on [date] via [API / portal / export]."

### 5.3 Buyer notification on record supersession

When a `DataRecord` is superseded (a correction is submitted), `src/lib/layer2/record-writer.ts` already notifies the entity. Extend it to also notify all grantee entities that have an active `DataAccessGrant` covering the domain and period of the superseded record.

New `NotificationType`: `RECORD_SUPERSEDED`

Email copy: "A record from [Supplier Name] for [domain], [period] has been updated. The original is preserved. Review the updated record in your supply chain view."

### 5.4 Data processing consent at grant creation

When a supplier creates a grant in `src/app/(portal)/access/GrantAccessForm.tsx`, add a required checkbox before the form can be submitted:

> "I understand that [Company Name] may use this data for their own reporting. Sharing this data does not transfer my liability for its accuracy."

This acknowledgement is logged as an `AuditEntry` with `eventType: 'ACCESS_GRANTED_WITH_CONSENT'` and the grantee name and scope in the payload. The `DataAccessGrant` record itself already records `grantedAt` — this audit entry is the legal consent record.

### 5.5 Scoped revocation cascade

When a grant is revoked, fire an Inngest event `access/revoked` with the `granteeEntityId` and the revoked domains/period. The handler:
1. Writes an `AuditEntry` with `eventType: 'ACCESS_REVOKED'`
2. Sends a `RECORD_SUPERSEDED`-style notification to the grantee: "Access to [Supplier X]'s [domain] records has been removed by the supplier."
3. In the buyer's supply chain view, that supplier's records for the revoked scope show "Access removed" instead of the record values

The revocation does not delete any data — it only removes the active grant. Records the buyer exported before revocation are outside the platform's control (covered by DPA).

**Schema changes:** New `RecordAccessLog` model; new `NotificationType` values `RECORD_SUPERSEDED`; new `AuditEntry.eventType` value `ACCESS_GRANTED_WITH_CONSENT`, `ACCESS_REVOKED`

### Acceptance criteria

- Supplier access page groups by buyer company, shows plain English grant summary per buyer
- Revoke all access from one buyer revokes all their active grants in one action
- A record supersession fires an email to all grantee entities with active access to that domain+period
- Grant creation requires checkbox consent; the `AuditEntry` is written on submit
- `RecordAccessLog` entries appear in the supplier's per-record access history

---

## Gap 6 — Buyer-Side API and Webhooks

**Priority: Medium.** The existing v1 API covers supplier ingest. There is no programmatic buyer-facing query surface.

### 6.1 Buyer query API endpoints

New routes under `/api/v1/`:

**`GET /api/v1/supply-chain`**
Returns the list of supplier entities the authenticated buyer has active `DataAccessGrant` records from. Per supplier: entity name, domains accessible, trust tier distribution, last record date.

**`GET /api/v1/supply-chain/[supplierId]/records`**
Query params: `domain`, `periodStart`, `periodEnd`, `trustTier`, `page` (default 1), `pageSize` (default 50, max 500).

Returns paginated records with full provenance on every record. Returns `403` if no active `DataAccessGrant` exists for `supplierId`. Writes a `RecordAccessLog` entry for each record returned.

**`GET /api/v1/supply-chain/gaps`**
Returns which entity+domain+period combinations have no records. For each active supplier relationship: which domains are empty or have only Tier C records, for the period the caller specifies.

All three routes require API key authentication via the existing `authenticateApiKey` middleware. Rate limit: 100 requests/minute per API key, using the existing rate limiter.

### 6.2 WebhookSubscription model

New model:

```
WebhookSubscription
  id          String
  entityId    String
  entity      Entity
  url         String      — HTTPS only; validated on creation
  events      Json        — array of WebhookEventType strings
  secretHash  String      — bcrypt hash of the HMAC signing secret
  secretPrefix String     — first 8 chars of the secret, shown in the UI for identification
  createdAt   DateTime
  isActive    Boolean
  lastDeliveryAt  DateTime?
  lastDeliveryStatus String?  — "200", "timeout", "error"
```

New enum `WebhookEventType`: `record.certified`, `record.superseded`, `access.granted`, `access.revoked`

The raw secret is shown to the user once at creation time (like an API key). It is never retrievable again. The platform uses the hash to verify delivery signatures.

### 6.3 Webhook delivery

New Inngest function: `deliver-webhook`

Triggered by events: `record/certified`, `record/superseded`, `access/granted`, `access/revoked`

For each active `WebhookSubscription` for the relevant entity that includes the event type:
1. Build the JSON payload
2. Sign it: `X-Arbor-Signature: sha256=HMAC-SHA256(rawSecret, JSON.stringify(payload))`
3. POST to the subscriber URL with `Content-Type: application/json` and a 10-second timeout
4. On failure: retry with exponential backoff, up to 3 attempts. On final failure: update `lastDeliveryStatus = 'error'`
5. Update `lastDeliveryAt` and `lastDeliveryStatus` on success

Payload shape:

```json
{
  "event": "record.certified",
  "entityId": "...",
  "recordId": "...",
  "domain": "ENERGY",
  "trustTier": "A",
  "periodStart": "2026-01-01T00:00:00Z",
  "periodEnd": "2026-03-31T23:59:59Z",
  "occurredAt": "2026-06-19T10:00:00Z"
}
```

### 6.4 Webhook management UI

New page: `src/app/(portal)/settings/webhooks/page.tsx`

- List active subscriptions: URL (truncated), event types, last delivery status, created date
- Create new: URL field (validated HTTPS), multi-select checkboxes for event types
- On creation: show the raw signing secret once with a copy button and a warning: "This secret will not be shown again."
- Delete (with inline confirmation — no modal per design rules)

### 6.5 API documentation page

New static page: `src/app/(marketing)/docs/api/page.tsx`

Sections:
- Authentication (Bearer API key, how to generate in Settings)
- Rate limits (100 req/min; 429 response shape)
- All v1 endpoints: method, path, parameters, response shape, error codes
- Webhook reference: event types, payload shapes, signature verification (with code example in Python and Node)
- Idempotency (for the ingest endpoint)

**Schema changes:** New `WebhookSubscription` model; new `WebhookEventType` enum

### Acceptance criteria

- `GET /api/v1/supply-chain/[supplierId]/records` returns 403 for a supplier the caller has no active grant for
- A new Tier A record fires a `record.certified` webhook to all buyer subscribers for that supplier
- Webhook payload is signed with HMAC-SHA256; the docs show how to verify it
- Rate limit returns 429 with `Retry-After` header after 100 requests/minute
- Webhook creation shows the raw secret once and stores only the hash

---

## Gap 7 — Compliance Posture

**Priority: High for enterprise sales.** Blocks procurement sign-off at every mid-market buyer. Expanded from the original plan to include full SOC 2 Type I completion, not just evidence preparation.

### 7.1 GDPR DPA as a downloadable document

The existing `/legal/dpa/page.tsx` is static prose. Changes needed:

- Convert the DPA to a versioned Markdown/MDX source file: `src/content/legal/dpa-v1.mdx`
- Add a "Download DPA" button that serves a pre-generated PDF from Vercel Blob (generate once, version it)
- Add a sub-processor appendix listing: Vercel (hosting, EU region), Supabase (database), Anthropic (document extraction), Resend (email), Inngest (job queue). For each: name, processing activity, data location, their own DPA link.
- Add a `lastUpdated` date to the DPA header. Update the PDF and version number when sub-processors change.
- Version the URL: `/legal/dpa/v1` — existing `/legal/dpa` redirects to the current version. Old versions remain accessible (buyers may have signed a specific version).

### 7.2 Security posture page

New marketing page: `src/app/(marketing)/security/page.tsx`

Sections:
- **Encryption:** data at rest (Supabase AES-256), data in transit (TLS 1.3 via Vercel), document storage (Vercel Blob private access with bearer token)
- **Access controls:** role-based access (ADMIN / CONTRIBUTOR / VIEWER / VERIFIER / AUDITOR), 2FA mandatory for ADMIN role (already implemented), API keys scoped per entity with bcrypt hashing
- **Audit chain:** plain English explanation of the cryptographic HMAC chain — "Every data record is cryptographically linked to the previous one. Any alteration breaks the chain and is immediately detectable."
- **Data residency:** confirm Vercel region (EU West or UK South — verify and state explicitly)
- **Penetration testing:** placeholder — "Scheduled for Q3 2026. Results summary will be published here."
- **SOC 2:** "SOC 2 Type I audit in progress. Expected completion Q4 2026." (update as milestone passes)
- **Responsible disclosure:** email address for security researchers

This page is referenced in the DPA and sent to enterprise buyer procurement teams alongside the DPA.

### 7.3 Security headers

In `next.config.ts`, add a `headers()` function that applies to all routes:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' *.inngest.com *.resend.com *.supabase.co *.vercel-blob.com
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

Adjust `connect-src` after confirming all external services in use.

### 7.4 Rate limit audit

Audit every public-facing or unauthenticated endpoint against the existing rate limiter in `src/lib/rate-limit.ts`. Confirm the rate limiter is applied to:
- `POST /api/signup`
- `POST /api/auth/forgot-password`
- `GET /api/submit/[token]` and `POST /api/submit/[token]`
- `GET /api/audit/verify-public` (new, covered in Gap 4)

If any of these are missing the limiter, add it. These are the endpoints most likely to be probed or abused.

### 7.5 SOC 2 Type I — evidence collection and audit engagement

SOC 2 Type I is a point-in-time audit: an accredited auditor reviews whether controls are *designed* appropriately. It does not require 6–12 months of operating history (that is Type II). Type I is achievable in approximately 3 months from evidence collection start.

**Trust Service Criteria to cover:**

**CC6 — Logical and physical access controls:**
- Evidence already available: role-based access (User.role enum), 2FA enforcement for ADMIN, API key scoping per entity, bcrypt key hashing, session JWT with entity-scoped claims
- Action needed: document the access control policy in a written information security policy (WISP) document — this is a Word/PDF document, not code

**CC7 — System operations:**
- Evidence available: Inngest job logs (extraction jobs, cron runs), Vercel deployment logs, database migration history
- Action needed: confirm log retention period (Inngest retains 7 days by default — upgrade to 30 days for SOC 2 evidence); confirm Vercel log retention settings

**CC9 — Risk mitigation:**
- Evidence available: DPA with sub-processor list (Gap 7.1), HMAC audit chain (tamper evidence), input validation via Zod on all API routes
- Action needed: write a risk register document covering the top 5 risks (data breach, extraction error, audit chain failure, third-party service failure, GDPR enforcement)

**CC1/CC2 — Control environment and communication:**
- Action needed: an Acceptable Use Policy and an Incident Response Plan — both short written documents, not code

**Engagement steps (operational, not code):**
1. Choose a SOC 2 auditor. Shortlist: Prescient Assurance, Johanson Group, or a Big 4 firm for credibility with enterprise buyers. Get quotes.
2. Use a readiness platform to manage evidence collection: Drata, Vanta, or Secureframe. These integrate with GitHub, Vercel, and Supabase to auto-collect much of the technical evidence.
3. Target Type I completion by end of Q4 2026. Type II (covering a 6-month operating period) follows approximately 12 months later.

**What goes in the codebase from this step:**
- `docs/security/WISP.md` — written information security policy (short, plain English)
- `docs/security/INCIDENT_RESPONSE.md` — incident response plan
- `docs/security/RISK_REGISTER.md` — top 5 risks with mitigations

These are not public-facing documents — they are internal evidence artefacts for the auditor.

### Acceptance criteria

- `/legal/dpa` has a "Download DPA" button that serves a versioned PDF with sub-processor appendix
- `/security` page exists with encryption, access controls, audit chain, and SOC 2 status information
- All security headers present on every response (verifiable at securityheaders.com)
- Rate limiter confirmed applied to signup, forgot-password, and submit/[token] endpoints
- `docs/security/` directory exists with WISP, incident response plan, and risk register
- SOC 2 readiness platform (Vanta/Drata/Secureframe) connected to GitHub and Vercel

---

## Gap 8 — Supplier Onboarding Improvements

**Priority: Medium.** Basic flow exists. These are adoption accelerators that reduce friction for the bulk of the target market.

### 8.1 Bulk document upload

Extend `src/components/UploadZone.tsx` to accept multiple files in a single drop or file picker selection.

- Limit: 20 files per batch, 50 MB per file
- Each file creates a separate `Document` record and a separate Inngest extraction job — no changes to Layer 1
- The upload page renders a queue below the drop zone: each file as a row with a status indicator (Queued / Reading / Needs attention / Ready)
- The queue updates in real time using the existing `ExtractionPoller` component pattern
- Files that fail document type detection show a plain English error inline: "We couldn't read this file. Try uploading a clearer version or a different format."

### 8.2 Invited supplier experience improvements

The existing `/submit/[token]` page serves buyer-initiated requests. Two improvements:

**Context:** Show the buyer's name and reason for the request above the upload area. Pull from `DataRequest.notes` and the buyer entity's `legalName`. Plain English: "[Company Name] has asked for your Energy records from Jan–Jun 2026 to help them with their own reporting. It should take about 10 minutes."

**Fallback path:** Add a "I don't have this document" link below the upload zone. Clicking it opens an inline form (no modal) for manual entry of the requested values. On submit, the record is written as Tier B (Declared) with `extractionMethod: MANUAL_ENTRY`. Plain English confirmation: "Got it. We've saved what you entered. You can upload a supporting document later to upgrade this to Verified."

### 8.3 Onboarding progress indicator

In `src/app/(portal)/onboarding/page.tsx`, render the three-step progress indicator from the PRD Section 7 Simplicity Constraint:

- Step 1: "Upload your first document" — complete when any `Document.status = ACCEPTED` for this entity
- Step 2: "Check what was found" — complete when any `ExtractionJob.status = COMPLETE` has been reviewed (all flagged fields confirmed or corrected)
- Step 3: "Share when a customer asks" — always shows as "Ready" with a link to the Requests page

Each step: large number, plain English title, one-line description, a checkmark when complete. No domain terms, no tier codes, no technical detail.

Show the indicator on the dashboard until all three steps are complete, then remove it permanently.

### 8.4 Email-to-upload (Phase D / plan now, build after SSO)

A supplier is given a unique upload email address: `upload-[entityToken]@arbor.io`

`entityToken` is a short URL-safe hash of `entityId`, stored as `Entity.uploadEmailToken String? @unique`. Generated at entity creation.

Infrastructure required: an inbound email processing service (Postmark inbound routing or SendGrid inbound parse). Configure `@arbor.io` MX records to route to the processing service.

New Inngest function: `process-inbound-email`
- Receives the parsed email payload via webhook from the email service
- Validates the `entityToken` against the database
- Extracts all attachments (PDF, image, spreadsheet)
- For each attachment: creates a `Document` record and triggers the standard extraction pipeline
- On unknown `entityToken`: silently discards (no reply — prevents enumeration)
- On success: sends a reply to the sender: "We received [filename]. We'll notify you when extraction is complete. Log in to review the results."

This is Phase D. Plan it now, build it after SSO and connectors are stable.

**Schema changes:** `Entity.uploadEmailToken String? @unique`

### Acceptance criteria

- Uploading 5 files at once creates 5 separate `ExtractionJob` records and the queue shows each status
- `/submit/[token]` page shows the buyer's company name and their stated reason for the request
- "I don't have this document" path creates a Tier B record and shows the plain English confirmation
- Onboarding progress shows correct completion state for each step, disappears after all three complete

---

## Gap 10 — SSO / SAML

**Priority: Medium (Phase D).** Supplier adoption at enterprise accounts is blocked without SSO. Many large manufacturers have Okta, Azure AD, or Google Workspace as their IdP. Without SSO, their IT teams reject the tool at procurement.

This is a real implementation task, not deferred because it is complex.

### 10.1 Provider selection

Use **WorkOS** (not Auth0 or rolling custom SAML). Reasoning:
- WorkOS is designed specifically for B2B SaaS SSO — the API maps directly to the multi-tenant model Arbor needs
- It handles SAML 2.0, OIDC, and social providers under one integration
- The existing NextAuth setup can integrate WorkOS via a custom WorkOS provider
- WorkOS charges per connection, which aligns with Arbor's per-buyer/enterprise pricing model

Install: `npm install @workos-inc/node`

New environment variables: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`

### 10.2 WorkOS organisation model

A `WorkOSOrganisation` is linked to an Arbor `Entity`. When an enterprise buyer or large supplier sets up SSO, they create a WorkOS organisation and configure their IdP connection.

**Schema change:** `Entity.workosOrganisationId String? @unique`

The WorkOS organisation ID is stored on `Entity` at SSO setup time. When a user authenticates via SSO, the WorkOS callback returns the organisation ID, which is used to look up the Arbor `Entity` and create or retrieve the user account.

### 10.3 Auth flow changes

Extend `src/lib/auth.ts` to add a WorkOS provider alongside the existing Credentials provider.

WorkOS authentication flow:
1. User visits `/login` and clicks "Sign in with your company account"
2. They enter their email address
3. The system checks if the email domain matches a `WorkOSOrganisation` — if yes, redirect to WorkOS authorisation URL for that organisation
4. WorkOS handles the SAML/OIDC exchange with the customer's IdP
5. WorkOS redirects back with a code; exchange for a profile containing email, name, and `organisationId`
6. Look up `Entity` by `workosOrganisationId`. If the user already has an account, log them in. If not, create a new `User` record associated with that `Entity` (auto-provisioning).
7. For auto-provisioned users: assign `role: CONTRIBUTOR` by default. Admins can upgrade roles in Settings.

### 10.4 SCIM provisioning (Phase D, after basic SSO)

WorkOS also supports SCIM for automatic user provisioning and deprovisioning. When an enterprise's IT team removes a user in Okta, SCIM fires a deprovision event. The Arbor SCIM endpoint should:
- Deprovision: set `User.isActive = false` (add this field to `User`), revoke all sessions
- Provision: create a new `User` with `role: CONTRIBUTOR`

New endpoint: `POST /api/workos/scim` — WorkOS handles the SCIM protocol, Arbor implements the webhook handler.

New field: `User.isActive Boolean @default(true)` — all auth checks must verify `isActive = true`.

### 10.5 SSO setup UI

New settings page: `src/app/(portal)/settings/sso/page.tsx`

Visible only to ADMIN-role users. Steps:
1. Enter your organisation's email domain(s)
2. WorkOS embed: the self-serve SSO setup wizard (WorkOS provides a React component for this — `@workos-inc/authkit-react`)
3. Test connection button — fires a test authentication and shows success/failure
4. Enforce SSO toggle: once enabled, all users on the domain must use SSO; password auth is disabled for the domain

### 10.6 Impact on existing auth

- Existing Credentials provider continues to work for non-SSO entities
- 2FA enforcement: SSO users skip TOTP (the IdP handles MFA). The mandatory 2FA for ADMIN accounts applies only to Credentials-auth admins. SSO admins are assumed to have MFA enforced at the IdP level.
- Password reset: disabled for SSO users — show "Your account uses SSO. Contact your IT team to reset your password."

**Schema changes:** `Entity.workosOrganisationId String? @unique`; `User.isActive Boolean @default(true)`

### Acceptance criteria

- A user whose email domain is registered as an SSO domain is redirected to WorkOS on login
- Auto-provisioned SSO users are created with `role: CONTRIBUTOR` and associated with the correct `Entity`
- SSO users see "Sign in with your company account" on the login page, not a password field after SSO is enforced
- SCIM deprovision event sets `User.isActive = false` and the user cannot log in
- Non-SSO entities are unaffected

---

## Gap 9 — ERP and Customs System Connectors

**Priority: Phase D.** The generic ingest API exists. This gap builds pre-configured connectors on top of it for the three most common systems in UK manufacturing SMEs. SAP and Oracle are not excluded because they are "professional services" — they are included with a defined scope.

**Defined scope:** A connector is a pre-built, configurable integration package that a customer's IT team can deploy without writing custom code. It is not a deep ERP customisation or a bespoke professional services engagement. The output of a connector is records posted to `/api/v1/ingest` — the connector handles authentication with the source system, field mapping, and scheduling.

### 9.1 IntegrationCredential model

New model for storing encrypted third-party credentials:

```
IntegrationCredential
  id                  String
  entityId            String
  entity              Entity
  provider            IntegrationProvider
  encryptedCredentials String  @db.Text   — AES-256-GCM encrypted JSON blob
  createdAt           DateTime
  lastSyncAt          DateTime?
  lastSyncStatus      String?
  isActive            Boolean
```

New enum `IntegrationProvider`: `CDS`, `SAP`, `NETSUITE`, `ORACLE`

Credentials are encrypted using AES-256-GCM with key `INTEGRATION_ENCRYPTION_KEY` from environment variables. New utility: `src/lib/crypto/credential-encryption.ts` — `encrypt(plaintext: string): string` and `decrypt(ciphertext: string): string`. The key must be a 256-bit (32-byte) value, base64-encoded.

Credentials are never returned in API responses — only `provider`, `createdAt`, `lastSyncAt`, and `lastSyncStatus` are ever exposed.

### 9.2 UK Customs CDS connector

HMRC's Customs Declaration Service (CDS) provides access to a company's customs declarations via an HMRC OAuth 2.0 API.

**Authentication:** HMRC OAuth 2.0 with `write:customs-declaration` scope. Store access token and refresh token encrypted in `IntegrationCredential`.

**New Inngest function:** `sync-cds-declarations`

Scheduled: daily at 07:00 UTC (separate from the certificate expiry cron).

Logic:
1. For each active `IntegrationCredential` where `provider = CDS`
2. Use the stored tokens to call the CDS `GET /customs/declarations` API for the past 90 days
3. For each declaration returned: map to the `CUSTOMS_DECLARATION` document type field schema from the admissibility spec
4. Post mapped records to the ingest pipeline (`writeRecordWithAuditEntry`) as `trustTier: B`, `extractionMethod: SYSTEM_INTEGRATION`
5. Deduplicate by `declaration_reference` — skip records already in the database
6. Update `IntegrationCredential.lastSyncAt` and `lastSyncStatus`

If the entity later uploads the original customs declaration PDF for the same `declaration_reference`, the tier upgrade pathway (PRD Section 12.2) upgrades the Tier B record to Tier A.

### 9.3 SAP connector

**Scope:** SAP ERP (S/4HANA and ECC) via OData services. Does not require SAP BASIS customisation — uses standard published OData services.

**Data sources mapped to Arbor domains:**

| SAP module | OData service | Arbor domain | Fields |
|---|---|---|---|
| FI-GL energy cost centres | `/sap/opu/odata/sap/ZMM_ENERGY_SRV` (custom, customer must activate) | ENERGY | period, quantity_kwh, cost_centre |
| MM goods receipt | `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV` | MATERIALS | material, quantity, unit, posting_date, plant |
| MM purchase orders | `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV` | MATERIALS | material, quantity, unit, supplier, order_date |
| SD delivery | `/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV` | LOGISTICS | ship_to_party, net_weight, delivery_date |

Note: SAP energy data is not exposed via a standard OData service — customers must either expose it via a custom service or use SAP's Sustainability Management module (SAP SuM). The connector supports both paths; the field mapping documentation covers each.

**Authentication:** SAP OData uses Basic Auth or OAuth 2.0 (S/4HANA Cloud). Store credentials encrypted in `IntegrationCredential`.

**New Inngest function:** `sync-sap-records`

Same pattern as CDS: scheduled daily, fetches delta records (new since `lastSyncAt`), maps to Arbor field schema, posts via ingest pipeline as Tier B.

**Field mapping documentation:** `docs/integrations/sap-field-mapping.md` — a reference document for the customer's SAP team showing which OData service to activate, which fields map to which Arbor domain fields, and how to configure the connector in Arbor Settings.

### 9.4 NetSuite connector

**Scope:** Oracle NetSuite via SuiteTalk REST API (NetSuite REST Record API).

**Data sources:**

| NetSuite record type | REST endpoint | Arbor domain |
|---|---|---|
| Vendor bills | `/record/v1/vendorbill` | MATERIALS (purchase records) |
| Item receipts | `/record/v1/itemreceipt` | MATERIALS (goods received) |
| Work orders | `/record/v1/workorder` | PRODUCTION |
| Transfer orders | `/record/v1/transferorder` | LOGISTICS |

**Authentication:** NetSuite uses OAuth 1.0a for SuiteTalk. Credentials required: Consumer Key, Consumer Secret, Token ID, Token Secret — all stored encrypted in `IntegrationCredential`.

**New Inngest function:** `sync-netsuite-records`

Same pattern as SAP. Fetches records modified since `lastSyncAt` using `lastmodifieddate` filter. Maps to Arbor field schema. Posts as Tier B.

**Field mapping documentation:** `docs/integrations/netsuite-field-mapping.md`

### 9.5 Oracle Cloud ERP — documentation only

Oracle Cloud ERP uses a different deployment model (per-customer SaaS instance). The REST API is well-documented but configuration varies significantly per deployment. For Oracle:

- Do not build a pre-configured connector in Phase D
- Publish `docs/integrations/oracle-field-mapping.md` with the field mapping guide and API authentication pattern (OAuth 2.0 with IDCS)
- Oracle integration is handled by the customer's Oracle implementation partner using the Arbor `/api/v1/ingest` endpoint and the field mapping guide
- Revisit pre-built connector if Oracle becomes a common request from enterprise buyers

### 9.6 Integration management UI

New settings page: `src/app/(portal)/settings/integrations/page.tsx`

Shows three cards: CDS, SAP, NetSuite. Each card:
- Status: Connected (green chip) / Not connected
- Last sync date and status
- "Connect" button (opens credential entry form, inline, no modal)
- "Sync now" button (triggers the Inngest function manually)
- "Disconnect" button (deletes the `IntegrationCredential` record — plain English inline confirmation before deletion)

The credential entry form never shows stored credentials. Once connected, only the provider name and sync status are displayed.

**Schema changes:** New `IntegrationCredential` model; new `IntegrationProvider` enum

### Acceptance criteria

- CDS OAuth flow connects, stores encrypted credentials, and the daily sync creates Tier B records
- A customs declaration PDF uploaded for the same `declaration_reference` as a CDS-synced record triggers the tier upgrade pathway
- SAP OData sync creates Tier B MATERIALS records; credentials are not returned in any API response
- NetSuite sync creates Tier B records from vendor bills and item receipts
- `IntegrationCredential.encryptedCredentials` cannot be decrypted without `INTEGRATION_ENCRYPTION_KEY`
- Integration management UI shows last sync date and status; "Sync now" triggers the Inngest function

---

## Schema migrations required (summary)

| Migration name | Tables and fields |
|---|---|
| `add_extraction_language_quality` | `ExtractionJob.detectedLanguage`, `.imageQualityScore`, `.imageQualityIssues` |
| `add_record_staleness` | `DataRecord.staleAfterDate` |
| `add_verifier_role_and_assignment` | `UserRole` + `VERIFIER`; `User.entityId` nullable; new `VerificationAssignment` table; new `VerificationStatus` enum |
| `add_auditor_role_and_access` | `UserRole` + `AUDITOR`; new `AuditorAccess`, `AuditPackageLog` tables |
| `add_record_access_log` | New `RecordAccessLog` table; new `AccessMethod` enum |
| `add_webhooks` | New `WebhookSubscription` table; new `WebhookEventType` enum |
| `add_notification_types` | `NotificationType` + `CERTIFICATE_EXPIRING`, `CERTIFICATE_EXPIRED`, `RECORD_SUPERSEDED` |
| `add_integration_credentials` | New `IntegrationCredential` table; new `IntegrationProvider` enum |
| `add_upload_email_token` | `Entity.uploadEmailToken String? @unique` |
| `add_sso_fields` | `Entity.workosOrganisationId String? @unique`; `User.isActive Boolean @default(true)` |

---

## New environment variables required

```bash
INTEGRATION_ENCRYPTION_KEY=    # 32-byte AES-256-GCM key, base64-encoded: openssl rand -base64 32
WORKOS_API_KEY=                # WorkOS API key
WORKOS_CLIENT_ID=              # WorkOS client ID
INBOUND_EMAIL_WEBHOOK_SECRET=  # Postmark / SendGrid inbound webhook verification secret
HMRC_CDS_CLIENT_ID=            # HMRC OAuth 2.0 client ID for CDS
HMRC_CDS_CLIENT_SECRET=        # HMRC OAuth 2.0 client secret
```

---

## New files and directories (summary)

```
src/
  app/
    (verifier)/
      assignments/
        page.tsx
        [id]/page.tsx
    (auditor)/
      [entityId]/page.tsx
    (marketing)/
      security/page.tsx
      docs/api/page.tsx
    (portal)/
      settings/
        webhooks/page.tsx
        integrations/page.tsx
        sso/page.tsx
  inngest/
    functions/
      deliver-webhook.ts
      sync-cds-declarations.ts
      sync-sap-records.ts
      sync-netsuite-records.ts
      process-inbound-email.ts
  lib/
    crypto/
      credential-encryption.ts
  api/
    v1/
      supply-chain/route.ts
      supply-chain/[supplierId]/records/route.ts
      supply-chain/gaps/route.ts
    audit/
      verify-public/route.ts
    workos/
      scim/route.ts

docs/
  security/
    WISP.md
    INCIDENT_RESPONSE.md
    RISK_REGISTER.md
  integrations/
    sap-field-mapping.md
    netsuite-field-mapping.md
    oracle-field-mapping.md

src/content/
  legal/
    dpa-v1.mdx
```

---

## What is deliberately not in this plan

- **Stripe billing integration** — the commercial model is defined in the PRD (Section 22). When to enforce paid tiers is a product decision, not a gap. No code change is required to have a pricing model; code is required to enforce it.
- **Deep SAP BASIS customisation or bespoke ERP professional services** — the SAP connector uses standard OData services. Customers requiring non-standard SAP configurations use the `/api/v1/ingest` endpoint with their own mapping.
- **SOC 2 Type II** — Type I is in this plan. Type II requires a 6–12 month operating period after Type I. It is the logical next step but is post-Phase D.
- **Federated identity for government / regulatory users** — government bodies accessing institutional data (Phase 3 PRD) have their own identity requirements (GOV.UK Verify, etc.). This is a Phase 3 concern.

---

**Document version:** 1.1  
**Last updated:** June 2026  
**Owner:** Nucleos Compliance Ltd  
**Companion:** `IMPLEMENTATION_PLAN.md` v2.0
