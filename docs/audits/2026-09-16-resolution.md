**Resolution of the 16 September launch-readiness audit — as of 21 September 2026**

This records what became of each finding in [the audit](2026-09-16-launch-readiness.md). The audit itself is left as written, against revision `317ba28`. Main is now at `ae086fe` (PR #109).

**Status: every P0 and P1 finding has a merged fix. The launch decision still stands until two things are done:** one real CBAM case completes a round trip in production, and the Nucleos database has backups. Both are described under "Still open" below.

**Finding by finding**

| # | Finding | Status | Where |
|---|---|---|---|
| 1 | P0 — CBAM reads and writes lose the tenant | Fixed | #90 scopes every case read and write to the caller's organisation through `CbamCaseLink`. Cases with no link are now invisible instead of shared. #94 scopes Nucleos' audit log and legacy `/api/cases/*` to the caller's tenant. |
| 2 | P0 — Confirmation upgrades Declared to Verified | Fixed | #90 certifies at confirmation using `certifyTier` in `src/lib/layer2/certification-policy.ts`, the same admissibility rules extraction uses. The test that expected an `OTHER` document to be promoted was changed. #107 added the requirement that a Verified field has source text. |
| 3 | P1 — Public supplier form redirects to login | Fixed | #92 adds `/api/supplier-form` to `src/lib/public-paths.ts`. The token is still validated downstream. |
| 4 | P1 — Failed CBAM handoffs cannot be retried | Fixed | #90 makes the handoff durable and resumable. The CBAM page lists unfinished handoffs with their problems until they are repaired. #109 made case creation idempotent in Nucleos (migration 010), so a retry returns the first case instead of creating a second one. |
| 5 | P1 — Units differ between intake paths | Fixed | #92 moves canonicalisation into the shared writer, so every path stores SI units. The audited correction of existing data ran on 2026-09-20: 2 records were superseded (`KG`→`kg`, `cu.m`→`m3`) with values unchanged, and none were unconvertible. |
| 6 | P1 — Batch ingestion not idempotent | Fixed | #92 reserves `(entityId, idempotencyKey)` bound to a request digest before writing, and replays the per-item outcomes. |
| 7 | P1 — Vulnerable dependencies | Fixed | #93: Next.js 16.3.5, Auth.js 5.0.0-beta.32. The proxy requires a real session user instead of `!!req.auth`. |
| 8 | P1 — Release gate misses deployed services | Fixed | #91: CI runs Arbor typecheck, lint, Jest, production build and contract check; Nucleos against Postgres plus the HTTP boundary check; and Brain. Unexpected skips fail the build. #98 cleared the four historical Postgres failures, and the known-failures list is empty. |
| 9 | P1 — Migration lineages and tenant context | Fixed | #94 sets RLS context for either tenant-setting convention. #98 completes the base lineage (migrations 008–009), and #100 retires the second lineage and adds a migrate script that builds the single one. The production Nucleos database was rebuilt and migrated on 2026-09-19. |
| 10 | P1 — Configuration and readiness | Partly fixed | #95 adds `/api/health/ready`, which checks the product can serve, and a request id on every Nucleos call. #97 stops `/ready` publishing database errors. The service token's expiry is now monitored, but nothing refreshes it (see "Still open"). Backup restoration has not been rehearsed. |
| 11 | P2 — Public scope contradicts the app | Fixed in the product | #99 corrects the About page and `CLAUDE.md`. PRD v1.3 still says Arbor does not produce CBAM returns (§3, §21.3, §25). |
| 12 | P2 — Pricing vs. uncapped pilot | Fixed | #99 makes signup invite-only through `PILOT_INVITE_CODES` / `SIGNUP_OPEN`, and the pricing page says so. #96 holds the upload quota correctly under concurrent uploads. |
| 13 | P2 — Orphan organisations, unverified email | Partly fixed | #96 creates the organisation and its first user in one transaction. #99 records email verification but does not require it to sign in. |
| 14 | P2 — Shares mix live data and a frozen hash | Fixed | #96 hashes over the scope the share displays. #99 makes a share a frozen submission of the exact records it was issued with (`SharedExport.recordIds`). |
| 15 | P2 — Unbounded reads | Mostly fixed | #96 bounds the Records summary and `/api/records`, and #99 bounds the dashboard. The CBAM case list still shows only the first 100 cases, with no next page. |
| 16 | P2 — Fragmented API behaviour | Partly fixed | #96 returns a JSON 401 for unauthenticated API calls. #95 adds request ids. There is still no single typed client and route wrapper. |
| 17 | P2 — Second product inside the deployment | Open | `nucleos/web` and `nucleos/marketing` are still in the repository. Root lint now excludes `nucleos/**` instead of passing it. |
| 18 | P2 — Stale security and ops documentation | Fixed | #96 brings the WISP, storage and migration statements in line with what is deployed. #100 archives the build-phase plans. |

**Found after the audit**

When real documents went through the system, they found defects that the audit's methods (code reading, test runs, local HTTP smoke tests) could not reach:

- **#103–#105:** The first real customs declaration produced no goods line. The parser read DECLARANT as the EORI and a label fragment as the invoice number, and it assumed layouts that real declarations do not use.
- **#106:** Specialist parsers returned their values in a nested shape, so every value reached Review as null while the evidence still carried it. This affected every document a specialist parser recognised.
- **#107:** Fields could be certified Verified with empty source text.
- **#108:** Goods lines had no place in the contract to carry evidence, so a CBAM document could never be Verified.
- **#109:** The unique rule meant to stop duplicate cases had no effect, because the importer EORI is encrypted differently each time it is stored.

**Lesson for the next audit:** put at least one real document of each launch type through the deployed stack. Static review and smoke tests passed while every one of these defects was present.

**Still open**

1. **A real CBAM case has not completed a round trip in production.** Production has no `CbamCaseLink` rows yet. The audit's release step 4 ("complete one real fixture journey through the deployed stack") is still outstanding, and it is the most valuable remaining piece of evidence.
2. **The Nucleos database has no backups.** It runs on the Supabase free tier, which pauses after 7 idle days and keeps no backups. A daily cron (#101) keeps it awake. The decision is to upgrade to Supabase Pro when customer onboarding starts. Treat that as a precondition for onboarding.
3. **The PRD contradicts the product.** PRD v1.3 still states that Arbor does not produce CBAM returns. It needs a revision that describes Nucleos, as `CLAUDE.md` now does.
4. **Nothing refreshes the service token.** `serviceTokenExpiry` in `src/lib/nucleos/service-auth.ts` reports when `NUCLEOS_INTERNAL_TOKEN` expires, but a new token has to be minted and set by hand. Someone needs to own that date.
5. **Legacy frontends (finding 17).** Retire `nucleos/web` and `nucleos/marketing` once old supplier links have expired. Until then they have no build, lint or dependency audit of their own.
6. **Smaller items:** email verification does not block sign-in (13); the CBAM list shows only the first 100 cases (15); there is no single typed Nucleos client and route wrapper (16).

**How this was checked**

The fixes for findings 2, 3, 6, 7, 8, 10, 15 and 17 were read in the code at `ae086fe`. The others are recorded from the merged PRs and the rollout record in `docs/INTEGRATION-ROLLOUT.md`. The production facts (migrations applied, the unit correction, the database rebuild) come from the owner's operations on the dates given. This document was not produced by a fresh audit run.
