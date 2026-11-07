# Service level objectives

Three promises about how Arbor behaves, each with how it's measured and what happens when it slips (E8, `docs/production-readiness.md`). They're measured over a rolling 30 days. The **error budget** is how much failure the target allows. When a budget is spent, reliability work goes ahead of feature work until it's back within target.

| | What it promises | Target | Error budget (30 days) |
|---|---|---|---|
| **1. Available** | Arbor answers and its dependencies work | 99.5% of readiness checks pass | about 3 h 36 min not ready |
| **2. Documents are read promptly** | An uploaded document is ready to review within 5 minutes | 95% of documents | 1 in 20 documents slower, or failed |
| **3. Saving certified data works** | Confirming a reviewed document saves its records | 99.9% of confirmations | 1 in 1,000 confirmations failing with a server error |

## 1. Available

**Measured by:** a Better Stack uptime monitor (free tier) calling `https://arbor-indol.vercel.app/api/health/ready` every 3 minutes, set up on 7 November 2026 (owner action O1). Sentry's uptime monitoring would check every minute, but needs a paid seat. Readiness returns 200 only when the database answers within 3 seconds, Redis answers, Nucleos answers, and production settings are present. It returns 503 otherwise. So a Nucleos outage counts against Arbor's availability, which is right: CBAM features don't work without it.

**Alert:** Better Stack opens an incident when a check fails and posts it to #arbor-alerts, alongside keepalive failures, Sentry errors and failed backups. At a 3-minute interval, an outage is noticed within about 3 to 6 minutes.

**So far:** measured from 7 November 2026. The two Nucleos outages on 7 November ([postmortems](postmortems/README.md)) together took roughly 29 to 38 minutes of the budget.

## 2. Documents are read promptly

**Measured by:** the share of documents uploaded in the last 30 days whose extraction completed within 5 minutes of upload. Failed or still-running extractions count as misses. The query is [`scripts/slo/extraction-within-5-minutes.sql`](../scripts/slo/extraction-within-5-minutes.sql). It only reads, and can be run in the Supabase SQL editor.

**Why 5 minutes:** a single extraction call is allowed 240 s (E4, `src/lib/ai/anthropic-client.ts`). Five minutes leaves room for the queue and one retry by the background job runner.

**Alert:** none yet. Run the query weekly until it's automated.

## 3. Saving certified data works

**Measured by:** the share of `POST /api/documents/[id]/confirm` requests that don't end in a 5xx, from Vercel's request logs (Observability → filter by route and status). Refusals (4xx: validation, already confirmed, no access) are correct answers, not failures. A 5xx means a reviewed value the user expected to certify wasn't saved.

**Alert:** Sentry raises an issue for an unhandled error on this route, and the Sentry alert rule posts it to #arbor-alerts.

**Why it matters most:** this is the moment a value becomes a certified record with an audit-chain entry. A failure here loses the user's review work, and repeated failures undermine trust in the database, which is the product.

## Review

Look at all three monthly, and after any incident. If a target is consistently met with room to spare, tighten it. If it's routinely missed for reasons users don't notice, it's measuring the wrong thing, so change the measure, not the number.
