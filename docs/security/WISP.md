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
- **At rest:** AES-256 (Supabase Postgres, Vercel Blob).
- **Document storage:** Vercel Blob private access; retrieval requires a bearer token.
- **Audit chain:** every data record is linked by an HMAC-SHA256 chain
  (`AUDIT_CHAIN_SECRET`); any alteration breaks the chain and is detectable.
- **TOTP secrets** are encrypted with AES-256-GCM before storage.

## 4. System operations (SOC 2 CC7)

- **Job execution** runs through Inngest with retries and per-function logs.
- **Deployment** is through Vercel with build/deploy logs retained.
- **Migrations** are version-controlled in `prisma/migrations/` and applied via
  `prisma migrate deploy` in the production build step.
- **Log retention:** Inngest retention to be raised to 30 days for SOC 2 evidence;
  Vercel log drains to be confirmed.

## 5. Change management

- All changes go through pull requests with review.
- Tests must pass with zero skips before deploy (deployment gate in `CLAUDE.md`).
- Layer purity is enforced: no AI in Layers 2/3, no DB writes in Layer 1.

## 6. Risk mitigation (SOC 2 CC9)

See `RISK_REGISTER.md`. The DPA and sub-processor list cover third-party risk;
input validation (Zod) covers injection risk; the audit chain covers tamper risk.

## 7. Incident response

See `INCIDENT_RESPONSE.md`.

## 8. Review cadence

This policy is reviewed at least annually and whenever a sub-processor changes.
