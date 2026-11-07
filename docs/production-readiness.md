# Production readiness

Audited 17 October 2026 against a 111-item checklist of production engineering
concerns. Arbor runs on Vercel (Fluid Compute), Supabase Postgres, Upstash Redis,
Inngest and Vercel Blob, with Nucleos as a separate service. Many items on the list
are handled by that platform or do not apply at this scale. This file records which
ones are covered and where, which are gaps, and the order the gaps are closed in.

The work is tracked as section E of `docs/engineering-todo.md`.

## Gaps, in order

| #   | Gap                                               | Checklist items      | Why it matters here                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | The database connection does not ask for TLS      | 73                   | `DATABASE_URL` carries no `sslmode` and `src/lib/prisma.ts` sets no `ssl` option, so node-postgres connects in plaintext unless the server insists. Certified records cross the public internet between Vercel and Supabase. The risk register claims TLS throughout.                 |
| E2  | Nobody is told when production breaks             | 58, 59, 62, 66, 110  | No error tracking, and 23 `console.error` calls land in Vercel logs nobody reads. Inngest functions other than extraction fail silently after their last retry. A failing cron returns 500 to Vercel and goes no further. Both past outages (Supabase, Upstash) were found by a user. |
| E3  | No backup the company controls                    | 83, 84, 85           | The database is the product, and it is on a free tier with no backups or point-in-time recovery. Supabase has already lost one project for us. A restore has never been tried.                                                                                                        |
| E4  | AI calls on request paths have no timeout         | 11, 12, 89, 90       | `new Anthropic()` defaults to a 10-minute timeout with 2 retries. `/api/query/nl` calls it twice on the request path with no `maxDuration`. The readiness database check has no timeout of its own either.                                                                            |
| E5  | CI does not catch schema or dependency drift      | 6, 81, 82, 108       | A `schema.prisma` change without a migration passes CI and fails in production (migrations are applied by hand, per `docs/DEPLOYMENT.md`). There is no Dependabot and `npm audit` was last run once, on 16 September.                                                                 |
| E6  | Logs cannot be followed across a request          | 59, 60               | No request ID, no structured fields. A failed CBAM handoff cannot be traced from Arbor's log into Nucleos's.                                                                                                                                                                          |
| E7  | Cron secrets compared with `===`, in seven copies | 67                   | Not timing-safe, and seven copies of the same check drift. One helper with `timingSafeEqual`.                                                                                                                                                                                         |
| E8  | Incidents and targets are not written down        | 63, 64, 65, 109, 111 | Two real incidents exist only in memory notes. No stated SLOs. The risk register (last reviewed June) does not list managed-service loss and says rate limiting fails open, which login does not.                                                                                     |

Owner actions, outside the code (each needs an account or a spend decision):

- **O1. Point an uptime monitor at `/api/health/ready`** (Better Stack, UptimeRobot or similar; free tiers suffice). It returns 200/503 and was built for this.
- **O2. Set `OPS_ALERT_WEBHOOK_URL`** (a Slack incoming webhook) in Vercel once E2 lands.
- **O3. Supabase Pro with point-in-time recovery**, already decided for customer onboarding. E3 is still needed: a backup held by the same provider that loses projects is not disaster recovery.
- **O4. Backup destination and key for E3**: where encrypted dumps live, and who holds the decryption key.
- **O5. Vercel Firewall rate-limit rule** on `/api/auth/*` and the public token routes (`/api/submit/*`, `/api/supplier-form/*`). Application rate limiting already exists; this stops the traffic before it costs a function invocation.

## Already in place

| Checklist items                        | Where                                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Rate limiting                        | Upstash, `src/lib/rate-limit*.ts`, on 26 routes. Login fails closed; readiness and keepalive ping Redis.                                                          |
| 6 CI/CD                                | `.github/workflows/ci.yml`: typecheck, lint, format, tests, build, contract drift, Nucleos suite on Postgres, Arbor–Nucleos boundary, brain. Skips fail the gate. |
| 11 Timeouts                            | Nucleos clients, `src/lib/net/safe-fetch.ts`, readiness Nucleos probe (3 s). AI calls are E4.                                                                     |
| 12, 13 Retries, exponential backoff    | `src/lib/layer2/serializable.ts` (backoff with jitter on write conflicts), Inngest `retries` on every function.                                                   |
| 14 Idempotency                         | `Idempotency-Key` on `/api/v1/ingest`, shares, admin definitions.                                                                                                 |
| 15–17 Queues, pub/sub, events          | Inngest: 8 functions, event-triggered.                                                                                                                            |
| 18, 19 Distributed transactions, saga  | Arbor certifies first and Nucleos is a resumable second step: a failed handoff leaves the document certified and `cron/cbam-handoffs` resumes it.                 |
| 20 Dead-letter queues                  | Extraction has `onFailure`; webhook delivery records its last failure. The rest is E2.                                                                            |
| 21 Cron jobs                           | `vercel.json`, 5 jobs, every one behind `CRON_SECRET`, failing closed.                                                                                            |
| 25 Indexing                            | 63 `@@index` across 48 models.                                                                                                                                    |
| 27 N+1                                 | Only in batch jobs (benchmarks, entity resolution, calibration, certificate expiry), bounded by caps. None on request paths found.                                |
| 28 Connection pooling                  | Supavisor pooler, `PrismaPg` capped at 3 per instance with idle release.                                                                                          |
| 36–40 Locking, races, deadlocks        | Audit-chain writes run Serializable and retry on P2034 (serialization failure and deadlock).                                                                      |
| 44 Backpressure                        | Inngest `concurrency` limits on every function that calls out.                                                                                                    |
| 54, 55 Rollbacks                       | Vercel instant rollback; migrations are forward-only and applied separately (`docs/DEPLOYMENT.md`).                                                               |
| 56, 57 Health checks                   | `/api/health/ready`: database, Redis, Nucleos (cold start told apart from down), env, service-token expiry.                                                       |
| 58 Monitoring (extraction)             | Accuracy and calibration drift runs, edge-triggered alerts (`src/lib/monitoring`).                                                                                |
| 67 Secrets                             | Env only, `.env*` ignored, production build refuses to start without required vars (`src/lib/production-env.ts`).                                                 |
| 68, 69 IAM, OAuth                      | Roles, admin 2FA, entity-scoped hashed API keys, WorkOS SSO and SCIM, OIDC between Arbor and Nucleos.                                                             |
| 70 Token rotation                      | `tokenVersion` revokes sessions; Nucleos uses Vercel-issued OIDC, nothing to rotate.                                                                              |
| 71 TLS (clients)                       | Vercel, with HSTS preload. Database link is E1.                                                                                                                   |
| 72 Encryption at rest                  | Supabase disk encryption; integration secrets and TOTP seeds AES-256-GCM in `src/lib/crypto`.                                                                     |
| 74, 75 WAF, DDoS                       | Vercel automatic DDoS mitigation. Custom rules are O5.                                                                                                            |
| 76 CORS                                | No `Access-Control-Allow-*` anywhere: same-origin only. `/api/v1` is server-to-server with API keys.                                                              |
| 77 CSRF                                | Session cookies are `SameSite=Lax`; WorkOS flow uses a state check.                                                                                               |
| 78 SQL injection                       | Prisma throughout; the three raw queries are tagged templates.                                                                                                    |
| 79 XSS                                 | No `dangerouslySetInnerHTML`; CSP without `unsafe-eval` in production.                                                                                            |
| 80 SSRF                                | `src/lib/net/ssrf-guard.ts` and `safe-fetch.ts`, re-checked per attempt and per redirect.                                                                         |
| 81 Migrations                          | 58 Prisma migrations, additive-first. Drift check is E5.                                                                                                          |
| 82, 102, 103 Schema and API versioning | `/api/v1`; the Arbor–Nucleos contract is generated and drift-checked; Nucleos results frozen by a versioned golden set.                                           |
| 101 Webhooks                           | Outbound HMAC-signed, inbound signatures verified.                                                                                                                |
| 107 Build caching                      | npm and pip caches in CI; Vercel build cache.                                                                                                                     |
| 109 Incidents                          | `docs/security/INCIDENT_RESPONSE.md`, including audit-chain compromise.                                                                                           |

## Not applicable, or the platform's job

| Checklist items                                                                                      | Why                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3 Load balancing, 4 reverse proxies, 5 API gateways, 9 service discovery                             | Vercel's edge routes and balances; there is one app and one known downstream (Nucleos, by URL).                                                                                                    |
| 7 Docker, 8 Kubernetes, 106 Helm, 104–105 IaC and Terraform                                          | No containers or clusters. Vercel config is in `vercel.json`; there is not enough infrastructure for Terraform to pay for itself.                                                                  |
| 45–47 Autoscaling, horizontal and vertical scaling, 89–90 cold starts, serverless limits             | Fluid Compute scales functions and reuses instances. Long work runs in Inngest, not on request paths.                                                                                              |
| 48–50 CDN, edge caching, cache invalidation; 2 caching                                               | Vercel CDN serves static assets. Certified data is per-entity and must be read fresh; caching it would risk serving a superseded record.                                                           |
| 29–35 Read replicas, sharding, partitioning, replication, leader election, CAP, eventual consistency | One Postgres primary, strongly consistent by design (the audit chain needs it). Revisit at volumes far beyond today's.                                                                             |
| 22–24 WebSockets, long polling, SSE                                                                  | Nothing needs a push channel; extraction status is polled by page refresh.                                                                                                                         |
| 10 Circuit breakers                                                                                  | Nucleos and the brain already degrade: timeouts, a resumable handoff, calibration as a no-op when the brain is down. A breaker adds state for little gain at this traffic.                         |
| 41–43 Memory leaks, GC, thread safety                                                                | Short-lived single-threaded Node functions.                                                                                                                                                        |
| 51 Feature flags; 52–53 blue-green, canary                                                           | Every deploy gets an immutable preview URL and instant rollback. Plan-gated features use `src/lib/constraints/plan-flags.ts`. Vercel Rolling Releases is there if a staged rollout is ever wanted. |
| 86 Multi-region, 95 network partitions                                                               | Single region, matched to the database. Multi-region writes would fight the audit chain's ordering.                                                                                                |
| 87 Chaos engineering                                                                                 | E3's restore drill is the exercise that matters here.                                                                                                                                              |
| 88 Cost optimisation; 91–94 latency, throughput, p99, tail                                           | Vercel Observability reports p75/p99 per route out of the box. Worth a look once there is real traffic; nothing to build.                                                                          |
| 96 Clock skew                                                                                        | One clock source (the database) orders the chain; TOTP allows a step either side.                                                                                                                  |
| 97 DNS, 98 TCP/UDP, 99 HTTP/2–3, 100 gRPC                                                            | Platform-level; HTTP/JSON is right for a service with one downstream.                                                                                                                              |
| 108 Dependency hell                                                                                  | One lockfile per runtime; scanning is E5.                                                                                                                                                          |
