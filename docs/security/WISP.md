# Written Information Security Policy (WISP)

**Owner:** Nucleos Compliance Ltd
**Applies to:** Arbor — Operational Data Infrastructure Platform
**Status:** SOC 2 Type I evidence artefact (internal)
**Last reviewed:** June 2026

This is an internal evidence document for the SOC 2 Type I audit. It is not a
public-facing document. The public security summary lives at `/security`.

---

## 1. Purpose and scope

This policy describes the security controls that protect operational data held in
Arbor. It covers all production systems, all personnel with production access, and
all sub-processors listed in the DPA.

## 2. Access control (SOC 2 CC6)

- **Role-based access.** Every user carries one of: ADMIN, CONTRIBUTOR, VIEWER,
  VERIFIER, AUDITOR, SYSTEM. Roles are enforced in `requireAuth`,
  `requireWriteAccess`, `requireAdmin`, `requireVerifier`, and
  `requireAuditorAccess`, and in edge middleware (`proxy.ts`).
- **Two-factor authentication** is mandatory for all ADMIN accounts, enforced at
  the portal layout boundary (`security-setup` redirect) and re-checked
  server-side in `requireAuth`.
- **API keys** are entity-scoped, bcrypt-hashed at rest, and shown to the user
  only once at creation.
- **Session invalidation.** A `tokenVersion` on each user invalidates all issued
  JWTs on password reset or forced logout.
- **External parties.** Verifiers and auditors hold no entity membership; auditor
  access is time-boxed via `AuditorAccess.expiresAt`.

## 3. Data protection

- **In transit:** TLS 1.3 (Vercel edge).
- **At rest:** AES-256 (Supabase Postgres and Supabase Storage).
- **Document storage:** a private Supabase Storage bucket (`documents`), one
  folder per entity. Objects are written and read only server-side with the
  service role (`src/lib/storage.ts`); no document has a public URL.
- **Audit chain:** every data record is linked by an HMAC-SHA256 chain
  (`AUDIT_CHAIN_SECRET`); any alteration breaks the chain and is detectable.
- **TOTP secrets** are encrypted with AES-256-GCM before storage.

## 4. System operations (SOC 2 CC7)

- **Job execution** runs through Inngest with retries and per-function logs.
- **Deployment** is through Vercel with build/deploy logs retained.
- **Migrations** are version-controlled in `prisma/migrations/` and applied as a
  deliberate step before the deploy that needs them (`npm run migrate:deploy`),
  never by the build — see `docs/DEPLOYMENT.md` for why and in what order.
- **Readiness:** `GET /api/health/ready` reports whether the deployment can serve
  (database, Nucleos, required settings, service-token expiry).
- **Log retention:** Inngest retention to be raised to 30 days for SOC 2 evidence;
  Vercel log drains to be confirmed.

## 5. Change management

- All changes go through pull requests with review.
- Tests must pass with zero skips before deploy (deployment gate in `CLAUDE.md`).
  CI (`.github/workflows/ci.yml`) runs Arbor's typecheck, lint, tests and build,
  the Nucleos suite against Postgres, the brain suite, contract drift and the
  Arbor–Nucleos boundary check; the Python report is gated on failures and skips.
- Layer purity is enforced: no AI in Layers 2/3, no DB writes in Layer 1.

## 6. Risk mitigation (SOC 2 CC9)

See `RISK_REGISTER.md`. The DPA and sub-processor list cover third-party risk;
input validation (Zod) covers injection risk; the audit chain covers tamper risk.

## 7. Incident response

See `INCIDENT_RESPONSE.md`.

## 8. Review cadence

This policy is reviewed at least annually and whenever a sub-processor changes.
