# Security Fix Plan — COMPLETE

Remediation of the findings from the read-only security review. **All 14 findings
(S1–S14) are shipped to production** across 5 PRs. This doc is now a completion
record; the original plan/rationale is preserved under each item.

| PR | Findings | Merged | `main` |
|----|----------|--------|--------|
| [#46](https://github.com/cezeneche/arbor/pull/46) | S2–S7 (containment) | ✅ | — |
| [#47](https://github.com/cezeneche/arbor/pull/47) | S1 (platform-admin model) | ✅ | `6d6446b` |
| [#48](https://github.com/cezeneche/arbor/pull/48) | S9, S10 (tokens/SSO) | ✅ | `dc997b1` |
| [#49](https://github.com/cezeneche/arbor/pull/49) | S8 (API keys) | ✅ | `51649e9` |
| [#50](https://github.com/cezeneche/arbor/pull/50) | S11–S14 (hardening) | ✅ | `7e5dba8` |

**Verification caveat (applies throughout):** this repo has no route-level test
harness, and the inbound-email / SSO / share flows need external infra (WorkOS, a
DB, an email provider) to drive end-to-end. Every fix was verified via pure-logic
unit tests + `tsc` + static review, **not** driven end-to-end. Items flagged
"manual smoke test recommended" below should be exercised against production.

---

## Root cause behind the worst finding

There was **no distinction between a tenant admin and a platform operator**. A user
belongs to one entity and may have `role = 'ADMIN'` *for that entity*, but
`requireAdmin()` only checked `role === 'ADMIN'` — it never bound the action to the
caller's `entityId`. PR2 introduced `User.isPlatformAdmin` + `requirePlatformAdmin()`
and moved every cross-tenant `/api/admin` route onto it.

---

## Highest risk

### S1. Tenant admin can act across tenants — ✅ SHIPPED (PR #47)
`requireAdmin()` had no entity binding, so any tenant admin could drive cross-tenant
`/api/admin` operations (e.g. `auditor-access` on an arbitrary `entityId`).

**Done:**
- Added `User.isPlatformAdmin Boolean @default(false)` + migration.
- Added `requirePlatformAdmin()` in `auth-helpers.ts` — `requireAuth()` then a fresh
  DB check of the flag (revocable, not carried in the JWT).
- Swept all `requireAdmin()` callers; classified 11 `/api/admin/*` routes as
  platform-scoped and moved them to `requirePlatformAdmin()`. Tenant-scoped routes
  (api-keys, webhooks, integrations, grants, entity, workos/organization) were left
  on `requireAdmin()` — verified they act only on the session's own `entityId` and
  `[id]` routes verify ownership, so **no `requireEntityAdmin` was needed**.
- PR5 added a structural regression test that then caught **`admin/benchmarks/compute`**
  (gated by a bespoke `PLATFORM_ADMIN_SECRET` header, missed by the sweep); migrated
  to `requirePlatformAdmin()`.

---

### S2. Inbound request email discloses records to arbitrary senders — ✅ SHIPPED (PR #46)
`parse-inbound-request` emailed assembled record values to whatever `fromEmail` the
inbound message carried, gated only by knowing `requests-<token>@…`.

**Done — DECISION: route everything to supplier approval.** The inbound function no
longer emails anyone. Covered requests are held with `awaiting: 'supplier_review'`
(+ matched answers); uncovered stay `NEEDS_DATA`. The `/inbound-requests` page shows
a "Ready to review and send" queue and no longer claims auto-answering. The
sender-authorisation grant check that was briefly built became unnecessary and was
removed. **Manual smoke test recommended.**

### S3. Inbound attachments stored public, unvalidated — ✅ SHIPPED (PR #46)
**Done:** validate by magic bytes (`selectInboundAttachments`), enforce size +
count caps, and store in the **private** Supabase bucket via `storeDocumentBytes`
(no more public Vercel Blob). **Manual smoke test recommended.**

### S4. 2FA management bypasses the central auth guard — ✅ SHIPPED (PR #46)
**Done:** `setup`/`enable`/`disable` use `requireAuth()` (restores tokenVersion
revocation + inactive checks); `disable` gained the fail-closed 2FA rate limiter.

---

## High / medium

### S5. VIEWER can mint supplier submission links — ✅ SHIPPED (PR #46)
**Done:** submission-token route now uses `requireWriteAccess()` (VIEWER → 403).

### S6. Benchmark-consent authorization is inconsistent — ✅ SHIPPED (PR #46)
**Done:** the entity-scoped PATCH now requires write access and writes the HMAC
audit entry; both consent routes share `setBenchmarkConsent` so they can't drift.

### S7. Gap/coverage query ignores grant scope — ✅ SHIPPED (PR #46)
**Done:** `gaps` applies each grant's domain/period scope (reuses the canonical
`grantCoversRecord`) and only reports granted domains (`computeScopedGaps`, unit-tested).

### S8. API keys are broad and long-lived; `v1/records` has no rate limit — ✅ SHIPPED (PR #49)
**Done:**
- `ApiKey` gained `scope` (READ | READ_WRITE), `expiresAt`, `ipAllowlist`. Existing
  keys default to READ_WRITE / no expiry / any IP — **DECISION: grandfather existing
  keys** (no breakage).
- `authenticateApiKey` enforces expiry + IP and returns scope; `authenticateApiKeyRequest`
  threads client IP; all 8 callers adopt it.
- Write endpoints (`v1/records` POST, `v1/ingest`, `v1/documents`) require READ_WRITE.
- `v1/records` GET + POST are rate-limited. Create route + API-keys UI expose
  scope/expiry/IP. Pure rules unit-tested.

### S9. Share & submission tokens stored plaintext — ✅ SHIPPED (PR #48)
**Done:** stored as SHA-256 (`opaque-token.ts`); `SharedExport.token → tokenHash`,
`DataRequest.submissionToken → submissionTokenHash`; raw token shown once at
creation, consume looks up by hash; shares list shows "Shown once". **DECISION:
invalidate existing links** (test-stage) — the migration clears old plaintext tokens.

### S10. SSO bridge token in URL, no `state`, replay risk — ✅ SHIPPED (PR #48)
**Done:** token payload carries a nonce whose hash is stored on the user and
atomically cleared on first use (`verifySsoToken` → `consumeSsoToken`), so replays
are rejected; `/authorize` sets a random `state` httpOnly cookie and `/callback`
rejects a missing/mismatched state. **Manual smoke test recommended (SSO login).**

### S11. CSP too permissive — ✅ SHIPPED (PR #50, partial)
**Done:** `'unsafe-eval'` dropped from the production `script-src` (kept dev-only
for HMR). `'unsafe-inline'` **retained** — Next.js needs it without a nonce
pipeline. **Follow-up:** full nonce-based `script-src` to remove `'unsafe-inline'`.

---

## Lower risk / reliability

### S12. Broad public allowlist — ✅ ADDRESSED (PR #50)
By design (each prefix self-authenticates). **Done:** added a structural test
asserting every `/api/admin/*` route gates on a platform guard (caught S1's
`benchmarks/compute` gap). **Follow-up:** an equivalent assertion for the other
self-authenticating `/api/*` prefixes (v1/query/cron).

### S13. Rate limiter can fail open — ✅ VERIFIED, no change (PR #50)
Audited every `checkRateLimit` call. The brute-force-critical gates (login, 2FA
complete/disable) **already fail closed**. The remaining fail-open limiters are
abuse caps on high-entropy / availability-sensitive flows (256-bit reset token,
signup, buyer-API budget) where fail-open is the correct trade-off. No change made.

### S14. Docs / config drift — ✅ SHIPPED (PR #50)
**Done:** reconciled `docs/integrations/inbound-email.md` — it described a static
`X-Inbound-Secret` header (code uses HMAC `x-inbound-signature`) and claimed
auto-answering (removed in PR1). Rewritten to match code, with a correct HMAC curl.

---

## Resolved decisions
1. **Inbound auto-answer (S2):** kill auto-email, route everything to supplier approval. ✅
2. **Platform admin (S1):** `User.isPlatformAdmin` flag. ✅ (operator account TBD — see below)
3. **Token-hash migration (S9):** invalidate existing links. ✅
4. **API key expiry (S8):** grandfather existing keys (READ_WRITE, no expiry). ✅
5. **Separate request email token (S2):** not needed — nothing is auto-disclosed now,
   so a leaked `uploadEmailToken` can't pull data. (Optional hardening, deferred.)

## Owner action items (not code)
- **Create a platform-operator account** with a fresh email (not the Acme Steel /
  personal login) and grant it:
  `UPDATE "User" SET "isPlatformAdmin" = true WHERE email = '<operator-email>';`
  Until then, all 11 `/api/admin/*` routes (incl. benchmark compute) return 403.
- **`benchmarks/compute` invocation changed** — it no longer accepts the
  `x-platform-admin-secret` header; it's a logged-in platform-operator action. The
  `PLATFORM_ADMIN_SECRET` env var can be retired.
- **Manual smoke tests** for the flows above (inbound email, SSO login, share/submit).

## Deferred follow-ups (nice-to-have, not blocking)
- Supplier "approve & send" endpoint + a dedicated `NEEDS_REVIEW` status (S2 currently
  overloads `NEEDS_DATA` with an `awaiting` marker).
- Full nonce-based CSP to drop `'unsafe-inline'` (S11).
- Structural auth test for the remaining self-authenticating `/api/*` prefixes (S12).
