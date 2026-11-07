# Nucleos deployed with a database password that didn't work

**Date:** 7 November 2026 · **Duration:** about 12 to 21 minutes (from the 16:01 deploy at the latest, possibly the 15:52 one, until 16:13 UTC) · **Severity:** SEV-2 · **Affected:** CBAM features (Nucleos). Arbor kept serving.

## What happened

Nucleos's `/ready` reported `{"db": "unreachable"}`. Its `DATABASE_URL` in Vercel had been replaced with a connection string whose password was wrong, and the next deploy picked it up.

## Timeline (UTC)

- **Earlier that afternoon** (exact times not recorded) while setting up the nightly backup, a working Nucleos database password was needed. The guidance offered, as an aside, to reset the database password and update Nucleos's `DATABASE_URL` in Vercel in the same sitting.
- **Before 16:01** Nucleos's `DATABASE_URL` in Vercel was replaced with a connection string pasted from Supabase. When the same string was tested, its password was rejected ("password authentication failed"). That test happened before saving it as a *backup* secret, so the bad value never reached GitHub, but nobody knew it had also gone into Vercel.
- **16:01:00** a Nucleos deploy picks up the new value, or the 15:52 deploy did. Nucleos can no longer reach its database.
- **Before 16:11** reported, and confirmed: Nucleos `/ready` returns 503 `db: unreachable`.
- **About 16:11** the owner resets the database password in Supabase. It's tested against the database on both pooler ports, then set as `DATABASE_URL` for production and preview.
- **16:13:04** the owner redeploys. `/ready` returns 200 three times. Arbor is ready again.

## Why it happened

1. Nucleos couldn't reach its database because its `DATABASE_URL` held a wrong password.
2. The wrong password was there because a pasted connection string replaced the working one in Vercel.
3. It was replaced because the instructions bundled "reset the password and update Vercel" into a task that didn't need it. The backup only needed **read access**, and a separate login was the right answer.
4. Nothing checked the new value before it went live: Vercel accepts any string, and the next deploy used it.
5. **Root cause:** a credential that production depends on could be changed, as a side step of other work, with no check that it worked before a deploy used it.

## Why we didn't know sooner

No uptime monitor. It was found because a person mentioned the change.

## What changed

- **The backup has its own login.** Nucleos's backup now uses a dedicated read-only login (`arbor_backup`), separate from the app's own. Backup work never needs to touch the app's credential again.
- **New credentials are tested first.** Any credential set during this work was tested against the real service before it was saved: the new database password, the R2 keys and the Slack webhooks.

## Still to do

- **An uptime monitor (O1).** This would have alerted within a minute.
- **A rule for any change to a production credential:** test the new value against the service, change it in the same sitting as anything that depends on it, redeploy, and confirm readiness. Arbor's own backup should also get a read-only login, as Nucleos's has.
