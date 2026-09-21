**Arbor launch-readiness audit — 16 September 2026**

**Decision: do not launch this revision as a public, multi-tenant product.** The application builds and has substantial working functionality, but organisation isolation, certification decisions, and recovery from interrupted workflows have concrete defects. Those defects affect the promises customers would rely on most. Source revision: `317ba28`.

This was a diagnostic review. Application source, dependencies, and database schemas were not changed. The new files under `docs/audits/` contain the report and evidence.

**What the application is about**

Arbor captures operational evidence once and makes it reusable. Suppliers upload bills, invoices, production records, certificates, and customs documents. AI extracts values and source text; people review them; the application stores structured records with provenance, trust tiers, and an audit chain. Buyers request, query, share, and export that information. Auditor and verifier roles support assurance workflows.

The implemented product also includes a CBAM workspace: scope checking, case creation, goods lines, supplier emissions requests, carbon price relief, calculations, and downloadable regulatory outputs. Nucleos provides that engine. Brain provides statistical calibration, constraints, entity matching, and privacy calculations.

The strongest customer promise is: **“Turn supplier documents into reusable, traceable data, then use that evidence to complete CBAM work.”** Whether CBAM should be the launch focus or an optional module is a product decision. The current code and public description disagree about that decision.

**Scope and verification**

The review mapped 618 Arbor TypeScript/TSX files, 55 page files, 99 API route files, 43 Prisma models, 46 Prisma migrations, the two Python services, the legacy Nucleos frontends, and deployment/security documentation. It traced the security and data-writing boundaries and inspected representative implementations throughout the major subsystems. This is broad coverage, not a claim that every line or every possible endpoint input was exhaustively verified.

| Check run | Result | What it establishes |
|---|---|---|
| Arbor TypeScript | Passed | Main application typechecks |
| Production Next.js build | Passed | Main application compiles and prerenders; initial sandbox attempt could not fetch Google Fonts |
| JavaScript tests | 169 suites, 1,718 tests passed | Existing automated tests pass; two initial socket-related failures disappeared with localhost permission |
| Brain tests | 104 passed | Existing Brain tests pass |
| Nucleos tests | 1,047 passed, 38 skipped | Database and live narrative workflows remain unproven in this run |
| Contract generation check | Passed | Generated TypeScript agrees with the checked contract |
| Arbor–Nucleos boundary check | 23/23 passed | Stateless extraction/calculation and supporting client contracts agree over local HTTP |
| Root lint | Failed: 17 errors, 4 warnings | All reported issues are in `nucleos/web` or `nucleos/marketing` |
| Arbor API smoke | 105 of 113 operations exercised | 71 login redirects, 25 responses with 401, 4 with 200, 2 with 400, 2 with 404, 1 with 422; no 5xx |
| Nucleos authentication smoke | All 69 protected operations returned 401 | Missing credentials are rejected; does not establish tenant ownership after login |
| Brain authentication smoke | All 7 protected operations returned 401 | Internal token gate works for missing credentials |
| Page smoke | 10 public pages returned 200; 3 portal pages redirected | Public page delivery and anonymous portal gating work |
| Production npm dependency audit | 45 affected packages: 4 critical, 12 high, 29 moderate | Advisory matches, including transitive packages; not 45 proven exploitable application defects |

The eight unexercised Arbor operations belong to Auth.js, Inngest, WorkOS redirects, and DPA generation. They were inventoried but their complete external flows were not executed. Nucleos public routes were inventoried; protected operations were exercised through FastAPI TestClient using isolated test configuration. Brain includes four public framework documentation routes in addition to health and its seven protected operations.

The legacy frontends have no installed app-specific dependencies in this checkout. A root-toolchain typecheck attempt reports missing packages for the legacy web app; that is not a valid independent build certification. The marketing attempt produced no diagnostics but resolved the root toolchain. Neither legacy app received an independently installed build or dependency audit.

The detailed inventory contains 224 explicit operations, including framework routes and legacy catch-all proxy methods. See [endpoint inventory](2026-09-16-endpoints.md), [machine-readable inventory](2026-09-16-endpoints.json), [isolated reproductions](2026-09-16-reproductions.cjs), [reproduction results](2026-09-16-reproductions.txt), and [npm audit output](2026-09-16-npm-audit.json).

**Launch blockers and required changes**

Priority here means launch impact, not a CVSS score. P0 blocks any multi-tenant customer launch; P1 blocks dependable use of the affected launch feature; P2 should be addressed before scaling or making the associated promise.

**1. P0 — CBAM reads and writes lose the Arbor tenant identity. Confirmed in code and isolated reproduction.**

`src/lib/nucleos/cases-client.ts:58` authenticates every customer with the same `NUCLEOS_INTERNAL_TOKEN`. The list at `src/app/(portal)/cbam/page.tsx:63` supplies no organisation filter. `GET /api/cbam/cases/[caseId]` checks a session and forwards the requested ID without an ownership check. The CPR claim and supplier-token routes also forward customer-selected goods-line identifiers without resolving Arbor ownership.

Some paths use `caseContext`, but `src/lib/nucleos/case-calculation.ts:55` explicitly allows unlinked cases. The return route repeats that fallback. Nucleos can correctly enforce the service token's tenant while still exposing multiple Arbor organisations that share that service identity.

An isolated invocation of the actual case route, with session A and a mocked downstream case belonging to B, returned 200 with B's case. This proves the missing Arbor guard; it does not claim a production data breach was observed.

Change: carry a trusted, server-derived tenant identity across every stateful service request; enforce ownership of cases, shipments, goods lines, claims, and supplier tokens. Deny unlinked legacy records until ownership is backfilled. Scope lists at the database boundary. Add two-organisation tests covering list, detail, calculate, return, claim creation, and supplier-token issuance.

**2. P0 — Confirmation can falsely upgrade Declared evidence to Verified. Confirmed by executing the actual policy functions.**

Extraction applies substantive admissibility rules in `src/lib/extraction/admissibility.ts`, including an estimated-meter-reading downgrade. Confirmation reassigns trust at `src/app/api/documents/[id]/confirm/route.ts:158` using a different policy. For non-CBAM documents, `deriveTrustTier` checks extraction existence and compulsory field presence only. It does not receive unresolved critical flags, estimated-reading status, or the full admissibility result.

Reproduction: the same complete electricity bill with `read_type=ESTIMATED` gets B at extraction and A at confirmation. An `OTHER` document also changes from B to A because its compulsory field set is empty. Existing tests explicitly expect the empty-compulsory-set promotion, so a green suite currently protects part of the defect.

Change: one authoritative certification policy at the write boundary, applied to effective reviewed values, document class, substantive quality rules, and unresolved evidence flags. Human confirmation of a number must not turn an estimated source into an actual source. Keep model confidence, document-backed provenance, and independent assurance as distinct facts.

**3. P1 — Public supplier forms cannot submit through Arbor. Confirmed over HTTP.**

`/supplier/[token]` is public, but `/api/supplier-form/[token]` is absent from `src/lib/public-paths.ts`. The browser submission receives `307 Location: /login` before its token-authenticated handler runs. This was reproduced against the production build on localhost.

Change: include the precise submission path in the public routing policy, preserve downstream token validation, bound and rate-limit input, and test the real browser-to-Arbor-to-Nucleos submission. The existing boundary check calls the service client directly and therefore misses the proxy failure.

**4. P1 — Failed CBAM handoffs have no usable retry, and partial results are stranded. Confirmed control-flow defect.**

Confirmation commits `ACCEPTED` before making the remote handoff. When the remote call fails, `src/lib/layer2/cbam-handoff.ts:99` instructs users to confirm again. The route rejects that at line 90 with `ALREADY_CONFIRMED`. Only this route invokes the handoff in application code. The reusable-document picker also offers accepted documents and routes them back into that confirmation flow.

The handoff returns immediately whenever a case ID exists, including PARTIAL results. The CBAM pages do not read the saved link's `status` and `problems` to provide a persistent repair queue. Sequential per-line requests can extend confirmation substantially; a process interruption after certification can prevent the handoff from running at all.

Change: commit a durable outbox job with confirmation, process case creation asynchronously, persist per-step progress, and provide a separate “Resume CBAM case” action. Resume missing pieces without recertifying or duplicating records. Display failed and partial handoffs until repaired.

**5. P1 — Canonical unit rules differ between ingestion paths. Confirmed in an isolated route invocation.**

Document confirmation normalises supported units. Manual records, `/api/v1/ingest`, and integration writes pass values and units directly to a shared writer that does not normalise them. A manual request for 100 kWh returned 201 and passed `100 / kwh` to storage; the canonical representation used by document confirmation is `360 / mj`.

The conversion API expects canonical storage, and the data-quality code explicitly regards noncanonical units as invalid. Customers can therefore create records through supported APIs that the product itself cannot consistently aggregate or convert.

Change: place unit validation and canonicalisation in the shared write service, preserve original values, validate field dimensions, and apply the same policy to every writer. Treat transaction dates and reporting intervals explicitly too: integration mappers currently produce equal period start/end while manual and document routes require positive intervals. Plan an audited correction of existing noncanonical data.

**6. P1 — Batch ingestion is not safely idempotent. Confirmed by transaction ordering.**

`src/app/api/v1/ingest/route.ts:72` checks for a completed audit marker, writes each record in a separate transaction, and appends the marker only after the batch. A crash between record commit and marker creation duplicates records on retry. Concurrent requests can both pass the initial check. Partial failures are not replayed as the original per-record response. The plan-capacity check also runs before replay detection, so a previously successful request can later be refused at capacity.

Change: reserve a unique `(entityId, idempotencyKey)` operation before writing; bind it to a request digest; track and replay item outcomes. Apply equivalent source-reference uniqueness to integration syncs. The handoff helper also performs remote creation before its unique local upsert; an isolated concurrent helper invocation created two remote cases. The current confirmation claim prevents a second concurrent confirmation, so that helper result is a latent retry hazard, not proof that today's double-click path duplicates cases.

**7. P1 — Production dependencies need security remediation. Verified against npm and selected maintainer advisories.**

The installed main application pins Next.js 16.2.6 and Auth.js 5.0.0-beta.31. The audit reports 45 affected production packages, including transitive/build tooling. Its suggested Next.js remediation is 16.3.5; validate the release's migration requirements and the resolved dependency tree before updating.

Next.js has a [critical AVIF image-optimisation advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4). Exploitability depends on whether attacker-controlled AVIF content reaches that optimiser; that was not established here. The [single-locale Turbopack proxy-bypass advisory](https://github.com/vercel/next.js/security/advisories/GHSA-6gpp-xcg3-4w24) has a configuration prerequisite not present in the checked `next.config.ts`, so it should not be described as a demonstrated bypass in Arbor.

The [Auth.js configuration-error advisory](https://github.com/nextauthjs/next-auth/security/advisories/GHSA-8fpg-xm3f-6cx3) describes the exact truthiness pattern in `src/proxy.ts` (`!!req.auth`). The application's live-session checks provide additional protection on many routes. Patch the affected dependencies and use a concrete session-user check. Do not apply `npm audit fix --force` indiscriminately: some suggested fixes change major versions or propose a Prisma downgrade.

**8. P1 — The release gate excludes the failures most likely to affect real customers. Confirmed CI configuration; historical database evidence clearly separated.**

`.github/workflows/ci.yml` runs npm installation, the main TypeScript check, and Jest. It omits lint, production build, Brain, Nucleos, contract drift, the HTTP boundary check, and real Postgres tests. `test:all` includes Nucleos but not Brain. Skipped Python tests exit successfully.

Today's run has 38 skipped tests. Separately, `docs/INTEGRATION-ROLLOUT.md:198` records an earlier Postgres run with 1,080 passes, four failures, and one skip, including CPR tables missing from one migration lineage. Those four failures were not rerun today and must be treated as unresolved historical evidence, not fresh results. The same document records the live document journey and chain seal as unfinished.

Change: a required release pipeline covering every deployed service, an ephemeral Postgres built from a canonical migration lineage, zero unexpected skips, authenticated two-tenant journeys, and a production-like upload → review → confirm → supplier response → return test. Keep optional live-model tests separately reported; never let their absence imply full release approval.

**9. P1 — Database migration and tenant-isolation conventions need reconciliation. Code and rollout documentation agree this is unresolved.**

Nucleos has two migration lineages that the rollout document says do not compose. Policies use both `app.current_tenant_id` and `app.tenant_id`. Some policies explicitly allow an unset tenant. Middleware sets a value through a separate Supabase RPC, while handlers also use SQLAlchemy connections; that RPC cannot establish the context of an unrelated SQL transaction. The SQLAlchemy helper suppresses setup errors. Legacy case paths still query by ID without uniform ownership checks; the ownerless-case fallback permits access without checking the caller's tenant.

Change: inventory the deployed schema and actual application role, adopt one migration sequence, enforce tenant context on the same transaction as the query, and reject missing context. Explicitly restrict or retire legacy `/api/cases/*` operations that are still mounted. Verify isolation using the exact production role, including any RLS-bypass privileges. Current deployment state was not inspected in this audit.

**10. P1 — Production configuration and health do not establish product readiness.**

`next.config.ts` checks four secrets only for Vercel production builds. Login fails closed when Redis is unavailable, but Redis is outside that build gate. Nucleos, Inngest, storage, and email have additional required settings. Local smoke logs showed Redis lookup failures; this is evidence about the local configuration, not the deployed environment.

`/health/ready` in Nucleos unconditionally reports ready, while `/ready` checks only database connectivity. Neither validates required tables or the full handoff capability. Nucleos clients use a static JWT environment variable; the documented token minting path defaults to an expiring token, with no refresh mechanism in Arbor.

Change: feature-specific startup validation, a single unambiguous readiness contract, schema/version checks, expiring-service-credential monitoring and rotation, and alerting on handoff/extraction failures. Provide per-request IDs across the services. Verify backup restoration and incident ownership; existing security documents describe policies but are not evidence that recovery has been rehearsed.

**Other downfalls, ambiguity, and streamlining**

**11. P2 — Public product scope contradicts the application.** `src/app/(marketing)/about/page.tsx:133` says Arbor does not produce CBAM returns or regulatory outputs. The portal does. `CLAUDE.md` makes the same older scope assertion; newer integration code intentionally implements CBAM. Publish one current product/architecture decision and align marketing, onboarding, support, and tests to it. Do not let different documents silently dictate incompatible designs.

**12. P2 — Pricing describes a self-service product that still behaves like an uncapped pilot.** The public page advertises paid plans and annual billing; entities default to unlimited PILOT and there is no self-service billing workflow. Manual invoicing can be a valid launch choice, but admission and plan assignment must be explicit. Use invite-only pilot access or connect real entitlements, quota reservations, and billing before open signup. Prevent concurrent uploads from overshooting a count-before-write quota.

**13. P2 — Signup can leave orphan organisations and does not prove identity.** Entity creation and user creation are separate writes in `src/app/api/signup/route.ts:44`. A failure or duplicate-email race can leave an organisation without its user. Signup also lacks email verification. Make creation transactional, handle uniqueness conflicts predictably, verify email ownership, and distinguish a self-declared legal entity name from verified business identity.

**14. P2 — Sharing mixes live data with a historical package hash.** `src/app/api/shares/route.ts:44` creates a package hash, but `/share/[token]` reads the current active records on each visit. Domain filtering is applied to the displayed share but not passed into package assembly. The verifier button accurately checks issuance/chain status, yet surrounding copy says the displayed dataset can be confirmed unaltered. Choose explicitly between a frozen, verifiable submission and a live authorised feed. Bind a snapshot's exact rows, scope, and version to its hash, or describe live-feed verification more narrowly.

**15. P2 — Pagination does not bound the expensive reads.** The records page paginates its table but loads the entire filtered record set for summaries. The dashboard and `/api/records` also read unbounded active sets. The CBAM list fetches a default first 100 and discards the total without pagination. Move summaries to database aggregation or maintained rollups, paginate APIs, stream large exports, and expose complete CBAM navigation. Run volume tests against realistic histories rather than only small fixtures.

**16. P2 — API behaviour is fragmented.** Most anonymous session APIs return HTML login redirects before their JSON guards run; several CBAM handlers use page-auth redirects. Upstream failures, business validation failures, 404s, and transport timeouts are mapped differently by separate clients. Some CPR fetches have no explicit deadline. Standardise API authentication responses, typed request/response schemas, deadlines, error codes, and correlation IDs through one service client and route wrapper.

**17. P2 — The deployment boundary still contains a second product.** Arbor uses Next 16/React 19; legacy Nucleos frontends use Next 14/React 18, separate locks, alternate login/state code, and two broad forwarding routes. The rollout document says a legacy frontend remains live while old supplier links expire. Preserve working old links during migration, then retire the duplicate surface. Until retirement, give each deployed app its own supported build, security scan, and ownership. Root lint currently applies Arbor's rules to those older apps while root TypeScript/Jest exclude them.

**18. P2 — Security and operational documentation contains stale assertions.** WISP still says documents use Vercel Blob and migrations run during build. Actual document storage uses private Supabase storage, and `docs/DEPLOYMENT.md` explicitly separates migrations from builds. The root README is effectively one line. Update documentation to deployed reality, record named operational owners and recovery evidence, and link the current PRD inside the repository. Treat public residency, independent verification, and assurance claims as statements requiring deployment evidence.

**What should be streamlined first**

Use one tenant-authorisation service, one certification policy, one normalised record writer, one durable handoff workflow, and one typed Nucleos HTTP client. These changes eliminate duplicated decisions that currently disagree. Keep SQL/Prisma transactions small; put remote work in retryable jobs with idempotency keys.

For the customer, make the main journey explicit: **Upload → Review evidence → Saved records → Share or complete a CBAM case.** Show document state, certification state, handoff state, and return readiness separately. An accepted document does not imply a complete case or a fileable return. Keep corrections and repair actions next to the affected item, including after a page refresh.

Consolidate requests into a clear work queue while keeping the underlying contracts distinct: a buyer asking for stored operational data and a supplier being asked for an emissions figure are different tasks. Explain “Verified” as document-backed provenance and show independent assurance separately. Expose CBAM according to the organisation's work rather than forcing every supplier through compliance vocabulary.

Defer additional graph, zero-knowledge, and advanced statistical functionality until the core data flow is dependable and measured. There is already useful investment here; the immediate bottleneck is correct integration and release evidence.

**Release sequence and acceptance criteria**

1. Repair tenant ownership and certification; patch affected runtime dependencies. Demonstrate that A cannot list, read, alter, export, or issue supplier credentials for B, and that estimated/generic evidence cannot become Verified accidentally.
2. Unify record normalisation and batch idempotency. Demonstrate equivalent stored results across document, manual, API, and connector intake, including retries and concurrent calls.
3. Implement recoverable handoffs and fix public supplier submission. Kill or fail the service at each boundary and prove that recovery creates exactly one complete case and preserves certification history.
4. Reconcile migration lineages and run the full suites against production-equivalent Postgres. Resolve the documented four failures and every unexpected skip; complete one real fixture journey through the deployed stack without sending real customer communications.
5. Align product scope, pilot/billing policy, live-share semantics, old links, readiness monitoring, and operational documentation. Start with a controlled pilot once the blockers are closed, then expand based on measured reliability and support load.

**What remains unverified**

This audit did not access production tenant records, alter either database, send customer messages, execute paid live-model workflows, or conduct authenticated browser journeys. It did not validate deployed RLS policies, production secret configuration, actual backup recovery, current regulatory correctness, Python dependency advisories, or the separate legacy apps' complete builds. Those are explicit release evidence gaps. The successful checks above should not be represented as end-to-end launch certification.
