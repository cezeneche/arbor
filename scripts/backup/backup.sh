#!/usr/bin/env bash
# One database's nightly backup, run by .github/workflows/backup.yml.
#
#   1. Dump production (read only, verified TLS) with pg_dump.
#   2. Restore the dump into an empty scratch database.
#   3. Prove the restore is whole and identical (scripts/backup/verify-restore.mjs).
#      A dump that cannot be restored, or restores wrong, never becomes a backup.
#   4. Encrypt it to the owner's age public key (scripts/backup/age-recipients.txt).
#      Nothing here, in CI or in the bucket, can decrypt it.
#   5. Upload it with a manifest to Cloudflare R2: daily/ always, monthly/ on the 1st.
#
# The plaintext dump exists only on the runner and is deleted before upload.
#
# Required: KIND (arbor | nucleos), SOURCE_URL, SCRATCH_URL (admin URL of an empty
# Postgres the drill may create databases on). Optional: SCHEMAS (default public),
# R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT
# (for a bucket in the EU jurisdiction).
# BACKUP_STOP_AFTER_DRILL=1 stops after step 3, for running the drill locally.
set -euo pipefail

: "${KIND:?KIND is required (arbor or nucleos)}"
: "${SOURCE_URL:?SOURCE_URL is required}"
: "${SCRATCH_URL:?SCRATCH_URL is required}"
SCHEMAS="${SCHEMAS:-public}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="$KIND-$stamp"
dump="$WORK/$name.dump"

# libpq's verify-full against the public roots plus Supabase's own root, the
# same trust the app uses (src/lib/db-tls.ts). Local hosts are left alone.
source_dsn="$SOURCE_URL"
host="$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$SOURCE_URL")"
if [[ "$host" != "localhost" && "$host" != "127.0.0.1" ]]; then
  roots="$WORK/roots.pem"
  node --no-warnings --input-type=module -e "
    import('$ROOT/src/lib/db-tls.ts').then(async m => {
      const { rootCertificates } = await import('node:tls')
      process.stdout.write([...rootCertificates, m.SUPABASE_ROOT_CA_2021].join('\n'))
    })" >"$roots"
  source_dsn="$(node -e '
    const u = new URL(process.argv[1])
    for (const p of ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey"]) u.searchParams.delete(p)
    u.searchParams.set("sslmode", "verify-full")
    u.searchParams.set("sslrootcert", process.argv[2])
    console.log(u.toString())' "$SOURCE_URL" "$roots")"
fi

schema_args=()
IFS=',' read -ra schema_list <<<"$SCHEMAS"
for s in "${schema_list[@]}"; do schema_args+=(--schema="$s"); done

echo "Dumping $KIND (${SCHEMAS})…"
pg_dump "$source_dsn" --format=custom --no-owner --no-privileges "${schema_args[@]}" --file="$dump"
source_version="$(psql "$source_dsn" -qAt -c 'show server_version')"

# The drill database gets what the dump assumes exists but does not carry:
# the roles its row-level-security policies name, and its extensions, created
# in the same schemas (Supabase keeps them in "extensions").
drill="drill_${KIND}_$$"
drill_url="$(node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; console.log(u.toString())' "$SCRATCH_URL" "$drill")"
psql "$SCRATCH_URL" -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE $drill"
trap 'psql "$SCRATCH_URL" -q -c "DROP DATABASE IF EXISTS $drill" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

schemas_sql="$(printf "'%s'," "${schema_list[@]}")"; schemas_sql="${schemas_sql%,}"
psql "$source_dsn" -qAt -c "
  SELECT DISTINCT r FROM pg_policies, unnest(roles) AS r
  WHERE schemaname IN ($schemas_sql) AND r <> 'public'" |
while read -r role; do
  [[ -z "$role" ]] && continue
  psql "$drill_url" -q -c "DO \$\$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$role') THEN CREATE ROLE \"$role\" NOLOGIN; END IF;
  END \$\$" >/dev/null
done
psql "$source_dsn" -qAt -F ' ' -c "
  SELECT e.extname, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname <> 'plpgsql'" |
while read -r ext nsp; do
  [[ -z "$ext" ]] && continue
  available="$(psql "$drill_url" -qAt -c "SELECT 1 FROM pg_available_extensions WHERE name = '$ext'")"
  [[ "$available" != "1" ]] && continue
  psql "$drill_url" -q -v ON_ERROR_STOP=1 -c "SET client_min_messages = warning" \
    -c "CREATE SCHEMA IF NOT EXISTS \"$nsp\"" \
    -c "CREATE EXTENSION IF NOT EXISTS \"$ext\" WITH SCHEMA \"$nsp\"" >/dev/null
done

echo "Restoring into a scratch database…"
# Every new database already has a public schema; the dump's CREATE SCHEMA for
# it is the one entry that would fail, so it is left out of the restore list.
pg_restore --list "$dump" | grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' >"$WORK/restore.list"
pg_restore --no-owner --no-privileges --exit-on-error --use-list="$WORK/restore.list" --dbname="$drill_url" "$dump"

echo "Checking the restore…"
summary="$(RESTORED_URL="$drill_url" SOURCE_URL="$SOURCE_URL" SCHEMAS="$SCHEMAS" KIND="$KIND" \
  node --no-warnings "$ROOT/scripts/backup/verify-restore.mjs" | tail -1)"
echo "Restore verified: $summary"

if [[ "${BACKUP_STOP_AFTER_DRILL:-}" == "1" ]]; then
  echo "BACKUP_STOP_AFTER_DRILL=1: stopping before encryption; nothing was kept."
  exit 0
fi

recipients="$ROOT/scripts/backup/age-recipients.txt"
if ! grep -q '^age1' "$recipients" 2>/dev/null; then
  echo "No age public key in scripts/backup/age-recipients.txt, so the backup cannot be encrypted." >&2
  exit 1
fi
age --encrypt --recipients-file "$recipients" --output "$dump.age" "$dump"
rm -f "$dump"
sha="$(sha256sum "$dump.age" | cut -d' ' -f1)"
size="$(wc -c <"$dump.age" | tr -d ' ')"

node -e '
  const [summary, kind, stamp, sha, size, pgDump, server] = process.argv.slice(1)
  console.log(JSON.stringify({ kind, takenAt: stamp, sha256: sha, bytes: Number(size),
    pgDump, sourceServer: server, drill: JSON.parse(summary) }, null, 2))' \
  "$summary" "$KIND" "$stamp" "$sha" "$size" "$(pg_dump --version)" "$source_version" >"$WORK/$name.json"

: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required to upload}"
: "${R2_BUCKET:?R2_BUCKET is required to upload}"
export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required to upload}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required to upload}"
export AWS_DEFAULT_REGION=auto
# EU-jurisdiction buckets live at <account>.eu.r2.cloudflarestorage.com.
endpoint="${R2_ENDPOINT:-https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com}"

day_prefix="daily/$KIND/${stamp:0:4}/${stamp:4:2}/${stamp:6:2}"
for f in "$dump.age" "$WORK/$name.json"; do
  aws s3 cp --only-show-errors --endpoint-url "$endpoint" "$f" "s3://$R2_BUCKET/$day_prefix/$(basename "$f")"
done
if [[ "${stamp:6:2}" == "01" ]]; then
  for f in "$dump.age" "$WORK/$name.json"; do
    aws s3 cp --only-show-errors --endpoint-url "$endpoint" "$f" "s3://$R2_BUCKET/monthly/$KIND/$(basename "$f")"
  done
fi
echo "Uploaded $day_prefix/$name.dump.age ($size bytes, sha256 $sha)."
