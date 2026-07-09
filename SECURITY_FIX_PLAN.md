# Security Fix Plan

Scope: remediate the findings from the read-only security review, verified against
the code on `main`. **Planning doc only — no code changes yet.** Every finding
below was confirmed by direct file inspection except where marked *(verify first)*.

Ordered by severity, then grouped into shippable PRs. Per `CLAUDE.md`: write the
test first, confirm it fails, implement, confirm it passes. No skips to green.

---

## Root cause behind the worst finding

There is **no distinction between a tenant admin and a platform operator**. A user
belongs to one entity and may have `role = 'ADMIN'` *for that entity*, but
`requireAdmin()` ([auth-helpers.ts:68](src/lib/auth-helpers.ts#L68)) only checks
`role === 'ADMIN'` — it never binds the action to the caller's `entityId`. Every
route that takes a target `entityId` from the request body/params and guards with
`requireAdmin()` is therefore cross-tenant. Fixing #1 is an auth-model change, not
a one-line patch, so it gets its own PR.

---

## Highest risk

### S1. Tenant admin can act across tenants — **confirmed**
`requireAdmin()` has no entity binding; `auditor-access` creates an `AuditorAccess`
for any `entityId` in the body ([auditor-access/route.ts:24](src/app/api/admin/auditor-access/route.ts#L24)).
The review lists the same pattern on verifier assignments, ZK statements, graph
neighborhood, entity links, flow anomalies, benchmarks, and calibration.

**Fix (PR 2):**
1. Introduce a real platform-operator concept. Recommended: `User.isPlatformAdmin
   Boolean @default(false)` (smaller blast radius than a new `Role`). Migration +
   backfill (all existing users `false`).
2. Add two guards in `auth-helpers.ts`:
   - `requirePlatformAdmin()` — `role === 'ADMIN' && isPlatformAdmin` (or just the
     flag). For genuinely cross-tenant operations.
   - `requireEntityAdmin(entityId)` — `role === 'ADMIN' && session.entityId ===
     entityId`. For tenant-scoped admin actions.
3. Sweep every `requireAdmin()` caller (`rg "requireAdmin\("`), classify each as
   tenant-scoped or platform-scoped, and swap to the right guard. For `auditor-access`,
   bind `entityId` to the session entity (a tenant admin may only grant auditors to
   *their own* entity) unless the caller is a platform admin.
4. Test: a tenant admin of entity A gets 403 posting `entityId = B` on each swept
   route; still 200 for their own entity.

---

### S2. Inbound request email discloses records to arbitrary senders — **confirmed**
`parse-inbound-request` emails assembled record values (totals, units, trust tiers)
to whatever `fromEmail` the inbound message carried, with no check that the sender
is an authorised buyer ([parse-inbound-request.ts:65-89](src/inngest/functions/parse-inbound-request.ts#L65)).
The only gate is knowing `requests-<token>@…`, and that token is the entity's
reused `uploadEmailToken`.

**Fix (PR 1) — policy decision required (see Open decisions):**
- **Default (recommended):** stop auto-emailing answers to unauthenticated senders.
  Resolve `fromEmail` → `User`/`Entity`; require an **active `DataAccessGrant`**
  (grantor = this entity, grantee = sender's entity) whose `domain`/period covers
  the parsed request. Only then send. Otherwise store the `InboundRequest` as
  `NEEDS_REVIEW` and notify the supplier to approve — never auto-disclose.
- Add an optional per-entity sender allowlist for the auto-answer path.
- Consider a **separate** high-entropy `requestEmailToken` distinct from
  `uploadEmailToken` so a leaked upload address can't pull data.
- Test: request from a non-granted sender → no email sent, status `NEEDS_REVIEW`;
  request from a granted buyer within scope → answered.

### S3. Inbound attachments stored public, unvalidated — **confirmed**
Attachments are trusted by provider `contentType` (no magic-byte sniff), have no
size or count limit, and are written `access: 'public'`
([process-inbound-email.ts:35-46](src/inngest/functions/process-inbound-email.ts#L35)).

**Fix (PR 1):**
- Reuse the normal-upload validator (magic-byte / MIME sniff) before storing.
- Enforce per-file max size and max attachment count per message (drop/flag excess).
- Store with `access: 'private'` and retrieve via bearer token, matching the
  standard upload path (`rg "access: 'public'"` to catch any siblings).
- Test: `.exe` renamed to `application/pdf` is rejected; blob URL is not public.

### S4. 2FA management bypasses the central auth guard — **confirmed**
`setup` and `disable` (and `enable`) use raw `auth()`
([2fa/setup/route.ts:11](src/app/api/auth/2fa/setup/route.ts#L11),
[2fa/disable/route.ts:12](src/app/api/auth/2fa/disable/route.ts#L12)), so a revoked
JWT (tokenVersion bump) or a deactivated user still passes. `disable` also has no
brute-force limit, unlike the challenge endpoint.

**Fix (PR 1):**
- Replace raw `auth()` with `requireAuth()` in setup/enable/disable, preserving the
  existing `pending2fa` and ADMIN-cannot-disable policy checks.
- Add the shared 2FA rate limiter to `disable`.
- Test: a session with a stale `tokenVersion` gets 401 on all three; disable is
  rate-limited after N bad codes.

---

## High / medium

### S5. VIEWER can mint supplier submission links — **confirmed**
[token/route.ts:12](src/app/api/requests/[id]/token/route.ts#L12) uses `requireAuth()`.

**Fix (PR 1):** swap to `requireWriteAccess()` (keep the `buyerEntityId` check).
Test: VIEWER → 403; CONTRIBUTOR/ADMIN → 201.

### S6. Benchmark-consent authorization is inconsistent — **confirmed**
[benchmark-consent/route.ts:13-18](src/app/api/entities/[entityId]/benchmark-consent/route.ts#L13)
allows any same-entity authenticated user (incl. VIEWER) to flip consent, with no
audit log. A sibling route requires write access + audit logging.

**Fix (PR 1):** require write/admin, add the audit-log write, align with the stricter
sibling (find it: `rg "allowBenchmarkAggregation"`). Test: VIEWER → 403; audit row written.

### S7. Gap/coverage query ignores grant scope — **confirmed**
[gaps/route.ts:32-50](src/app/api/v1/supply-chain/gaps/route.ts#L32) fetches grantor
records filtered only by the *requested* period, not by each grant's own
`domain`/`periodStart`/`periodEnd` ([schema:650-652](prisma/schema.prisma#L650)).

**Fix (PR 1):** intersect each grant's scope with the requested window; only surface
gaps within granted domains/periods. Iterate per-grant rather than merging all
records per supplier. Test: grant scoped to `Energy`/2024 → other domains never
appear in `missingDomains`.

### S8. API keys are broad and long-lived; `v1/records` has no rate limit — **confirmed**
`ApiKey` has no scope/expiry/IP/permission ([schema:729](prisma/schema.prisma#L729));
[v1/records/route.ts:24](src/app/api/v1/records/route.ts#L24) has no `checkRateLimit`
(gaps route does).

**Fix (PR 4):**
- Schema: add `scope` (e.g. `READ` / `READ_WRITE`), `expiresAt`, optional
  `ipAllowlist`. Migration + backfill policy for existing keys (see Open decisions).
- Enforce scope + expiry + IP in `authenticateApiKey`.
- Add `checkRateLimit(RATE_LIMITS.buyerApi, entityId)` to `v1/records` (both verbs).
- Test: expired key → 401; read-scoped key → 403 on write; rate limit trips.

### S9. Share & submission tokens stored plaintext — **confirmed**
`SharedExport.token` ([schema:859](prisma/schema.prisma#L859)) and
`DataRequest.submissionToken` ([schema:626](prisma/schema.prisma#L626)) are plaintext;
reset tokens are hashed.

**Fix (PR 3):** store a hash (mirror the reset-token pattern); look up by hash, keep a
short non-secret prefix for indexing if needed. **Migration decision:** existing links
can't be re-hashed from plaintext without invalidating them — decide grandfather vs
invalidate (Open decisions). Test: DB row holds only the hash; a valid link still resolves.

### S10. SSO bridge token in URL, no `state`, replay risk — **confirmed (consume: verify first)**
[callback/route.ts:51](src/app/api/workos/callback/route.ts#L51) redirects with
`?token=`; [authorize/route.ts:22](src/app/api/workos/authorize/route.ts#L22) sends no
`state`.

**Fix (PR 3):**
- *Verify first:* read `sso-token.ts` and `/sso/complete` to confirm there is no
  single-use store today.
- Add a one-time consume store (nonce row or Redis `SETNX`), reject reused tokens.
- Add a `state` param bound to the initiating session (CSRF / fixation defence).
- Prefer setting the session cookie server-side over passing a token in the URL
  (avoids Referer/history leakage).
- Test: replayed `?token=` → 401; mismatched `state` → rejected.

### S11. CSP too permissive — **confirmed**
`script-src 'self' 'unsafe-inline' 'unsafe-eval'` ([next.config.ts:11](next.config.ts#L11)).

**Fix (PR 5):** move to nonce-based `script-src` via middleware; drop `'unsafe-eval'`
first (most removable), then `'unsafe-inline'` once nonces are wired. Verify hydration
in preview. `'unsafe-eval'` removal is the priority.

---

## Lower risk / reliability

### S12. Broad public allowlist — **confirmed (by design)**
[public-paths.ts:30-45](src/lib/public-paths.ts#L30). Each prefix self-authenticates.
**Fix (PR 5):** add a test asserting every allowlisted `/api/*` prefix has
handler-level auth; document the justification inline. Narrow where possible.

### S13. Rate limiter can fail open — *(verify first)*
**Fix (PR 5):** read the shared limiter; make it fail **closed** for sensitive routes
(or require explicit opt-in to fail-open), and alert when Redis/Upstash is
unreachable. Test: limiter with backing store down → sensitive route returns 429/503,
not 200.

### S14. Docs / config drift — *(verify first)*
Inbound-email code verifies HMAC ([route.ts:42](src/app/api/inbound-email/route.ts#L42))
— reconcile any doc that still says "static secret header." Reconcile upload UI/docs
against actual code limits/storage. **Fix (PR 5):** docs-only, plus a test pinning the
documented limits to the code constants so they can't drift again.

---

## Execution sequencing

- **PR 1 — contain (handler-level, no schema):** S2 (stop auto-disclosure), S3
  (private + validated attachments), S4 (2FA guard + rate limit), S5 (VIEWER token),
  S6 (consent), S7 (gaps scope). Highest impact, lowest blast radius. Ship first.
- **PR 2 — auth model:** S1 platform-vs-tenant admin (schema + guards + route sweep).
- **PR 3 — secrets at rest:** S9 (hash tokens), S10 (SSO one-time + state).
- **PR 4 — API keys:** S8 (scope / expiry / IP / rate limit).
- **PR 5 — hardening:** S11 (CSP nonce), S12 (allowlist test), S13 (fail-closed
  limiter), S14 (docs).

## Open decisions for the owner
1. **Inbound auto-answer (S2):** kill the auto-email entirely and route everything to
   supplier approval, or keep auto-answer but gate it behind an active in-scope grant
   + allowlist? (Recommend: gate behind grant; approval fallback.)
2. **Platform admin (S1):** `User.isPlatformAdmin` flag (recommended) vs a new
   `PLATFORM_ADMIN` role? Who are the initial platform admins to backfill `true`?
3. **Token-hash migration (S9):** grandfather existing share/submission links
   (dual-read plaintext + hash during a window) or invalidate them on deploy?
4. **API key expiry (S8):** default max lifetime, and how to treat existing keys —
   force expiry date on backfill, or grandfather until first rotation?
5. **Separate request email token (S2):** worth splitting `uploadEmailToken` into
   distinct upload vs request tokens?

## Verify-before-implementing (didn't fully confirm in review)
- S10 one-time consume — read `src/lib/sso/sso-token.ts` + `/sso/complete`.
- S13 fail-open — read the shared rate-limit module.
- S14 — read the inbound-email / upload docs to locate the exact drift.
