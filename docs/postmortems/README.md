# Postmortems

One file per incident, named `YYYY-MM-DD-short-name.md`, written within five working days (`docs/security/INCIDENT_RESPONSE.md` §3). They're blameless: each asks what in the system let the failure happen and go unnoticed, not who did it.

| Date | Incident | Users affected | Duration |
|---|---|---|---|
| 2026-09-19 | [Arbor's Redis disappeared; every sign-in failed](2026-09-19-upstash-redis-lost.md) | Everyone trying to sign in | Unknown, until found |
| 2026-09-19 | [Nucleos's database was paused by Supabase](2026-09-19-nucleos-database-paused.md) | CBAM features | Unknown, until found |
| 2026-11-07 | [A deploy filled Nucleos's disk at start-up](2026-11-07-nucleos-bundle-tmp-full.md) | CBAM features | 17 minutes |
| 2026-11-07 | [Nucleos deployed with a database password that didn't work](2026-11-07-nucleos-database-credential.md) | CBAM features | About 12 to 21 minutes |

The pattern across all four: **each was found by a person, not by an alert.** Closing that gap is the first action in each one.

## Template

```
# <What broke, in plain words>

**Date:** · **Duration:** · **Severity:** (INCIDENT_RESPONSE §1) · **Affected:**

## What happened
## Timeline (UTC)
## Why it happened
(Ask "why" until the answer is something in the system, not a person.)
## Why we didn't know sooner
## What changed
## Still to do
```
