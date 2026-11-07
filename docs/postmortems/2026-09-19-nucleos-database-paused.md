# Nucleos's database was paused by Supabase

**Date:** found 19 September 2026 · **Duration:** unknown, until found · **Severity:** SEV-2 · **Affected:** CBAM features (Nucleos)

## What happened

Nucleos's Supabase database, on the free tier, was paused after a week without activity. A paused free project is not reachable, and Supabase warns that it can become unrestorable. Nucleos couldn't serve any CBAM request.

## Timeline (UTC)

- **Unknown:** the project was paused for inactivity.
- **19 September:** found while working on Nucleos.
- **19 September:** the database was restored and fully migrated. `/ready` returned `{db: ok, schema: ok}`, and the owner confirmed in the SQL editor that the newest tables existed.

## Why it happened

1. CBAM requests failed because Nucleos couldn't reach its database.
2. It couldn't reach the database because Supabase had paused the project.
3. It was paused because nothing had used it for seven days.
4. Nothing used it because Nucleos had no traffic yet, and no job kept it awake.
5. **Root cause:** a free-tier database with no regular activity and nothing watching it, holding data with no copy anywhere else.

## Why we didn't know sooner

Nothing checked Nucleos on a schedule, and there were no users to notice.

## What changed

- **PR #101:** a daily Vercel cron calls Nucleos's `/ready`, which queries the database and keeps it awake.
- **E3 (PR #160, 7 November):** both databases are backed up every night to Cloudflare R2, encrypted to a key only the owner holds. Each backup is restored and checked before it's kept. A lost project is now recoverable.
- **E2 (PR #157):** Nucleos reports errors to Sentry, which alerts #arbor-alerts.

## Still to do

- Supabase Pro with point-in-time recovery at customer onboarding (owner action O3). Free projects still pause.
- An uptime monitor on Arbor's `/api/health/ready`, which also checks Nucleos (O1).
