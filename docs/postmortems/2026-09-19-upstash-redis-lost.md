# Arbor's Redis disappeared, and every sign-in failed

**Date:** found 19 September 2026 · **Duration:** unknown, until found · **Severity:** SEV-2 · **Affected:** everyone trying to sign in to Arbor

## What happened

Arbor's Upstash Redis database, which backs the login rate limiter, stopped existing: its hostname (`busy-monkfish-150073.upstash.io`) no longer resolved. The rate limiter is built to **fail closed**, which is correct for a brute-force guard, so every sign-in was refused. The page said "Invalid email or password", so it looked like a wrong password rather than an outage.

## Timeline (UTC)

- **Unknown:** the free-tier Redis database was removed.
- **19 September:** the owner couldn't sign in. Diagnosed from `vercel logs`, which showed DNS failures for the Redis host.
- **19 September:** a new Upstash database was provisioned through the Vercel integration. The stale `UPSTASH_*` variables had to be deleted, because the code preferred them over the integration's `KV_REST_API_*` variables and they still pointed at the dead host. Sign-in worked again.

## Why it happened

1. Sign-in failed because the rate limiter couldn't reach Redis and failed closed.
2. It couldn't reach Redis because the database no longer existed.
3. It no longer existed because it was on a free tier that removes idle or unused resources.
4. Nothing kept it in use or noticed it going, because the only thing that touched it was a sign-in.
5. **Root cause:** a dependency the product can't work without was on a plan that can disappear, with nothing checking it was still there.

## Why we didn't know sooner

The readiness check (`/api/health/ready`) only checked that the Redis settings **were present**, not that Redis **answered**. It reported healthy throughout. The failure surfaced to users as a wrong-password message.

## What changed

- **PR #102:** readiness pings Redis and reports not ready if it doesn't answer.
- **PR #102:** the daily keepalive cron touches Redis as well as Postgres, and fails if either is down.
- **E2 (PR #157):** a keepalive failure now raises a critical alert in #arbor-alerts and emails platform admins.

## Still to do

- **An uptime monitor on `/api/health/ready` (owner action O1).** Readiness would now say "not ready", but nothing watches it.
- Paid tiers for services the product can't run without, at customer onboarding.
