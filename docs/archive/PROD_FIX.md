# Production Hardening Plan — Arbor

Security, reliability, and maintainability fixes identified in the July 2026 codebase
review. Ordered so the two HIGH auth issues ship first. Every change follows the
repo deployment gate: test first (confirm red), implement, confirm green; no skipped
tests; no calculation logic in Layer 3; no AI/DB-boundary violations.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done

**Implementation status (2026-07-07):** all phases implemented. Full suite green
(683 tests), `tsc --noEmit` clean. Migration `20260707000000_add_two_factor_
verification_nonce` is additive/nullable — deploy before app rollout. Not yet done:
comment-cleanup pass (3.6) and provider-side config of `WORKOS_WEBHOOK_SECRET` /
inbound-email HMAC signing.

---

## Phase 0 — Security-critical (ship first, separate PRs)

### 0.1 [HIGH] Close the 2FA bypass  `[ ]`

**Root cause.** `update({ totpVerified: true })` is client-controlled and the jwt
callback (`auth.ts:114-126`) trusts it. `/api/auth/2fa/complete` verifies the code
but persists no state, so nothing links "code verified" to "JWT may upgrade". An
attacker with the victim's password can call `update({ totpVerified: true })`
directly and obtain a full session without the second factor.

**Fix — server-side one-time verification nonce.**
1. Schema: add `twoFactorVerifiedNonce String?` and `twoFactorVerifiedExpires DateTime?`
   to `User` (additive, nullable — safe migration, no backfill).
2. `src/lib/auth/two-factor-nonce.ts` (pure + one atomic consume): generate nonce,
   `hashNonce` (SHA-256), `consumeTwoFactorNonce(userId, raw)` clears the nonce only
   when the hash matches and it has not expired (single-use `updateMany` guard).
3. `/api/auth/2fa/complete`: on success, mint a nonce, store its hash + ~2 min expiry,
   return the raw nonce in the JSON.
4. `/2fa-verify` page: `update({ totpVerifiedNonce: nonce })`.
5. jwt callback (`auth.ts`): replace the `session.totpVerified` trust with
   `await consumeTwoFactorNonce(token.sub, session.totpVerifiedNonce)`; only upgrade
   on success. Drop the old `totpVerified` field entirely.

**Tests.** nonce match/mismatch/expired/double-consume; upgrade succeeds once and
fails on replay; **forged `totpVerifiedNonce` does not clear `pending2fa`** (pins the
bypass shut).

### 0.2 [HIGH] Fail closed on auth-critical rate-limit paths  `[ ]`

**Root cause.** `checkRateLimit` returns `allowed:true` on missing config and on Redis
errors. TOTP verify and login rely on it as their only brute-force gate.

**Fix.** Add `checkRateLimit(config, id, { failMode?: 'open' | 'closed' })`, default
`'open'` (unchanged everywhere). When `'closed'` and the limiter is null/throws,
return `{ allowed:false }`. Apply `failMode:'closed'` at the TOTP-verify call
(`2fa/complete`) and the login call (`auth.ts`). Escalate the log to `error` so an
outage is visible. Document `UPSTASH_*` as production-required.

---

## Phase 1 — Reliability

### 1.1 [MEDIUM/HIGH] Retry serializable transactions on write-conflict  `[ ]`

`src/lib/layer2/serializable.ts`: `runSerializable(fn, {retries=3})` wraps
`prisma.$transaction(fn, { isolationLevel: 'Serializable' })`, retrying Prisma `P2034`
(write conflict/deadlock) with jittered backoff; rethrows anything else. Apply at
`documents/[id]/confirm`, `records/manual`, `submit/[token]`, `v1/ingest` (per record).
The submit `ALREADY_RESPONDED` control-flow throw is not `P2034`, so it surfaces as 409
unchanged — pinned by test.

### 1.2 [MEDIUM] Cap submit/[token] entries  `[ ]`

`entries: z.array(...).min(1).max(MAX_BATCH_ENTRIES)` (200), shared constant in
`constants.ts`. Test: 201 entries ⇒ 400.

---

## Phase 2 — Security hardening

- **2.1 [MEDIUM]** Rate-limit every API-key entrypoint with `RATE_LIMITS.buyerApi`
  keyed by entity: `/api/query`, `/api/records/convert` (mirror `v1/supply-chain/*`).
  Factor `enforceBuyerApiLimit(entityId)`.
- **2.2 [MEDIUM]** Verify real webhook signatures: WorkOS SCIM (HMAC over raw body,
  `WORKOS_WEBHOOK_SECRET`), inbound-email (provider HMAC + timestamp tolerance),
  `timingSafeEqual`.
- **2.3 [MEDIUM]** Upload magic-byte sniffing (`src/lib/upload/sniff.ts`): verify PDF/
  JPEG/PNG signatures, derive extension from sniffed type, UUID storage path. AV = TODO.
- **2.4 [LOW]** `institutional/enquiry` zod + length caps + IP rate limit; `share` page
  throttles `RecordAccessLog` writes (once per token per window).

---

## Phase 3 — Maintainability & correctness

- **3.1 [MEDIUM]** `src/types/next-auth.d.ts` augmentation + `getSessionUser()`; auth
  helpers return typed user; remove `as Record<string, unknown>` casts route-by-route.
- **3.2 [MEDIUM]** Extract `storage-path.ts`, `layer3/grant-scope.ts`, shared
  `DOMAIN_LABELS` / `ALL_DOMAINS` in `constants.ts`.
- **3.3 [LOW]** Add `AUDIT_CHAIN_SECRET`, `PLATFORM_ADMIN_SECRET`, `CRON_SECRET`,
  `BRAIN_URL`, `BRAIN_INTERNAL_TOKEN`, `WORKOS_WEBHOOK_SECRET` to `.env.example`.
- **3.4 [LOW]** Rate-limit `/api/query/nl` (cost control), keyed by user.
- **3.5 [LOW]** Add `/api/records/convert/units` (or fix the error string); delete
  empty `src/app/api/reports/*` dirs.
- **3.6 [LOW]** Comment cleanup pass (drop `Gap/Upgrade/Core` changelog tags) — last,
  no functional change.

---

## Sequencing

| PR | Contents | Gate |
|----|----------|------|
| 1  | 0.1 2FA nonce | Blocks launch |
| 2  | 0.2 fail-closed rate limit | Blocks launch |
| 3  | 1.1 retry wrapper + 1.2 entries cap | Reliability |
| 4  | 2.1 API-key limits + 3.4 NL limit | |
| 5  | 2.2 webhook signatures | |
| 6  | 2.3 upload sniffing | |
| 7  | 2.4 public endpoint hardening | |
| 8  | 3.1 typed session | |
| 9  | 3.2 dedup + 3.3 env + 3.5 dead code | |
| 10 | 3.6 comment pass | |
