# Restoring a database from backup

Arbor's and Nucleos's databases are backed up every night by `.github/workflows/backup.yml` (E3 in `docs/production-readiness.md`). This is how to get one back.

## What exists

- **Where:** the Cloudflare R2 bucket named in the `R2_BUCKET` GitHub secret.
  - `daily/<arbor|nucleos>/YYYY/MM/DD/<name>.dump.age`, one per night.
  - `monthly/<arbor|nucleos>/<name>.dump.age`, the backup taken on the 1st of each month.
  - Each backup has a `<name>.json` manifest beside it: when it was taken, its SHA-256, the Postgres versions, and the restore drill's counts.
- **What:** Arbor's `public` schema, and Nucleos's `public` and `cbam` schemas, as `pg_dump` custom-format archives. Every one was restored into an empty database and checked before it was encrypted: chains whole and linked, every record's hash on its entry, and each entity's restored chain identical to production at that moment.
- **Not included:** files in Supabase Storage (uploaded documents) and Supabase's own schemas (`auth`, `storage`). Arbor signs users in itself, so `auth` holds nothing of Arbor's.
- **Who can read them:** only the holder of the age private key, which the owner keeps in a password manager. GitHub, Cloudflare and anyone holding these files can't decrypt them.

## Restore

You need `age`, the PostgreSQL client tools (version 18 or newer), and either the AWS CLI or the Cloudflare dashboard. On a Mac: `brew install age postgresql@18 awscli`.

1. **Get the key.** Copy the private key from the password manager into a file only you can read:
   ```
   umask 077 && pbpaste > ~/arbor-backup-key.txt
   ```
   It is the line starting `AGE-SECRET-KEY-`.
2. **Download the backup and its manifest.** Use the Cloudflare dashboard (R2 → the bucket → the file → Download), or the CLI with an R2 API token:
   ```
   export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… AWS_DEFAULT_REGION=auto
   R2=https://<account-id>.eu.r2.cloudflarestorage.com   # the R2_ENDPOINT secret; no ".eu" outside the EU jurisdiction
   aws s3 ls --endpoint-url $R2 s3://<bucket>/daily/arbor/2026/11/
   aws s3 cp --endpoint-url $R2 s3://<bucket>/daily/arbor/2026/11/07/arbor-20261107T021700Z.dump.age .
   aws s3 cp --endpoint-url $R2 s3://<bucket>/daily/arbor/2026/11/07/arbor-20261107T021700Z.json .
   ```
3. **Check it arrived intact.** The output must match `sha256` in the manifest:
   ```
   shasum -a 256 arbor-20261107T021700Z.dump.age
   ```
4. **Decrypt.**
   ```
   age --decrypt --identity ~/arbor-backup-key.txt --output arbor.dump arbor-20261107T021700Z.dump.age
   ```
5. **Prepare the target database.** Use a new Supabase project, or any Postgres 15 or newer. Outside Supabase, first create the roles the row-level-security policies name, plus the extensions:
   ```sql
   CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
   CREATE SCHEMA IF NOT EXISTS extensions;
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
   CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
   ```
6. **Restore.** Leave out the `public` schema's own creation, because every database already has one:
   ```
   pg_restore --list arbor.dump | grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' > restore.list
   pg_restore --no-owner --no-privileges --exit-on-error --use-list=restore.list --dbname "$TARGET_URL" arbor.dump
   ```
7. **Check it.** If production is still up, compare against it. The check only reads production:
   ```
   RESTORED_URL="$TARGET_URL" SOURCE_URL="$PRODUCTION_URL" KIND=arbor \
     node --no-warnings scripts/backup/verify-restore.mjs
   ```
   If production is gone, set `SOURCE_URL` to the restored database itself. That checks every chain is whole and every record's hash is on its entry. Then, with the app pointed at the restored database, run `/api/audit/[entityId]/verify` for each entity. That recomputes every hash with `AUDIT_CHAIN_SECRET`.
   For Nucleos, use `KIND=nucleos SCHEMAS=public,cbam`.
8. **Switch over.** Set `DATABASE_URL` to the restored database on the **arbor** Vercel project (or on **nucleos-api** for Nucleos) and redeploy. For Arbor, `npx prisma migrate status` should then report the database up to date, because the migration history table is restored with everything else.
9. **Clean up.** Delete `arbor.dump`, the `.age` file and `~/arbor-backup-key.txt`.

## Quarterly drill

The nightly drill proves each backup restores, but it never uses your key, because CI doesn't have it. Once a quarter:

1. Restore last night's Arbor backup into a local Postgres, following steps 1–7 against production.
2. Record the date in `docs/engineering-todo.md` under E3.

A backup you have never decrypted is not a backup you know you can use.
