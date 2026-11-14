#!/usr/bin/env bash
# Nightly backup of uploaded documents, run by .github/workflows/backup.yml.
#
#   1. List the private `documents` bucket (Supabase Storage, S3 protocol, read
#      with storage-only access keys, not the service-role key).
#   2. List what R2 already holds under documents/.
#   3. Copy each file not yet backed up: download, check its size against the
#      listing, encrypt it to the owner's age key, upload it to
#      documents/<path>.age. Files are never overwritten in storage, so one copy
#      is enough and the backup only grows.
#   4. Check that every document record's file is in the backup, and write a
#      manifest to documents-manifests/.
#
# Plaintext exists only on the runner, one file at a time, and is deleted
# before the next. Nothing here can decrypt the copies.
#
# documents/ is outside daily/, so R2's 35-day rule never deletes it.
#
# Required: SUPABASE_S3_ENDPOINT (https://<ref>.storage.supabase.co/storage/v1/s3),
# SUPABASE_S3_REGION, SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY,
# SOURCE_URL (Arbor's backup database login), R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
# R2_SECRET_ACCESS_KEY, R2_BUCKET. Optional: R2_ENDPOINT, DOCUMENTS_BUCKET
# (default documents), AGE_RECIPIENTS_FILE.
set -euo pipefail

missing=()
for v in SUPABASE_S3_ENDPOINT SUPABASE_S3_REGION SUPABASE_S3_ACCESS_KEY_ID SUPABASE_S3_SECRET_ACCESS_KEY \
  SOURCE_URL R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  [[ -z "${!v:-}" ]] && missing+=("$v")
done
if ((${#missing[@]})); then
  echo "The documents backup is not set up: ${missing[*]} not set. See docs/runbooks/restore-database.md, \"Uploaded documents\"." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECKS="$ROOT/scripts/backup/document-checks.mjs"
BUCKET="${DOCUMENTS_BUCKET:-documents}"
R2="${R2_ENDPOINT:-https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# AGE_RECIPIENTS_FILE is for testing the script with a throwaway key.
recipients="${AGE_RECIPIENTS_FILE:-$ROOT/scripts/backup/age-recipients.txt}"
if ! grep -q '^age1' "$recipients" 2>/dev/null; then
  echo "No age public key in scripts/backup/age-recipients.txt, so files cannot be encrypted." >&2
  exit 1
fi

# Each side has its own credentials; neither is exported for the other.
source_s3() {
  AWS_ACCESS_KEY_ID="$SUPABASE_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$SUPABASE_S3_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION="$SUPABASE_S3_REGION" aws --endpoint-url "$SUPABASE_S3_ENDPOINT" "$@"
}
backup_s3() {
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION=auto aws --endpoint-url "$R2" "$@"
}
# One JSON array of {key, size}; the CLI follows continuation tokens itself.
list_objects() {
  "$@" --output json --query '{o: Contents[].{key: Key, size: Size}}' | node -e '
    let s = ""; process.stdin.on("data", d => (s += d)).on("end", () =>
      process.stdout.write(JSON.stringify((s.trim() ? JSON.parse(s).o : null) ?? [])))'
}
check() {
  node --no-warnings --input-type=module -e "
    const m = await import(process.argv[1])
    const out = m.$1(...JSON.parse(process.argv[2]))
    process.stdout.write(typeof out === 'string' ? out : JSON.stringify(out))" "$CHECKS" "$2"
}

echo "Listing the $BUCKET bucket…"
list_objects source_s3 s3api list-objects-v2 --bucket "$BUCKET" >"$WORK/source.json"
echo "Listing the backup…"
list_objects backup_s3 s3api list-objects-v2 --bucket "$R2_BUCKET" --prefix documents/ >"$WORK/backup.json"

node -e 'const [s, b] = process.argv.slice(1).map(f => JSON.parse(require("fs").readFileSync(f, "utf8")))
  process.stdout.write(JSON.stringify([s, b.map(o => o.key)]))' "$WORK/source.json" "$WORK/backup.json" >"$WORK/args.json"
check toCopy "$(cat "$WORK/args.json")" >"$WORK/to-copy.json"
count="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).length)' "$WORK/to-copy.json")"
echo "$count new file(s) to back up."

copied=0
while IFS=$'\t' read -r key size; do
  [[ -z "$key" ]] && continue
  dest="$(check backupKey "$(node -e 'console.log(JSON.stringify([process.argv[1]]))' "$key")")"
  plain="$WORK/file"
  source_s3 s3 cp --only-show-errors "s3://$BUCKET/$key" "$plain"
  got="$(wc -c <"$plain" | tr -d ' ')"
  problem="$(check sizeProblem "$(node -e 'console.log(JSON.stringify([process.argv[1], Number(process.argv[2]), Number(process.argv[3])]))' "$key" "$size" "$got")")"
  if [[ "$problem" != "null" ]]; then
    echo "$problem" >&2
    exit 1
  fi
  sha="$(sha256sum "$plain" | cut -d' ' -f1)"
  age --encrypt --recipients-file "$recipients" --output "$plain.age" "$plain"
  rm -f "$plain"
  backup_s3 s3 cp --only-show-errors --metadata "sha256=$sha,bytes=$size" "$plain.age" "s3://$R2_BUCKET/$dest"
  rm -f "$plain.age"
  copied=$((copied + 1))
done < <(node -e 'for (const o of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))) console.log(o.key + "\t" + o.size)' "$WORK/to-copy.json")

echo "Checking every document record's file is in the backup…"
list_objects backup_s3 s3api list-objects-v2 --bucket "$R2_BUCKET" --prefix documents/ >"$WORK/backup-after.json"
SOURCE_URL="$SOURCE_URL" node --no-warnings "$ROOT/scripts/backup/document-paths.mjs" >"$WORK/paths.json"
node -e 'const r = f => JSON.parse(require("fs").readFileSync(f, "utf8"))
  const [p, s, b] = process.argv.slice(1).map(r)
  process.stdout.write(JSON.stringify([{ documentPaths: p, sourceKeys: s.map(o => o.key), backedUpKeys: b.map(o => o.key) }]))' \
  "$WORK/paths.json" "$WORK/source.json" "$WORK/backup-after.json" >"$WORK/coverage-args.json"
check coverageProblems "$(cat "$WORK/coverage-args.json")" >"$WORK/problems.json"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
node -e 'const r = f => JSON.parse(require("fs").readFileSync(f, "utf8"))
  const [stamp, copied, paths, source, backup, problems] = process.argv.slice(1)
  console.log(JSON.stringify({ kind: "documents", takenAt: stamp, copied: Number(copied),
    filesInStorage: r(source).length, filesInBackup: r(backup).length,
    documentRecords: r(paths).length, problems: r(problems) }, null, 2))' \
  "$stamp" "$copied" "$WORK/paths.json" "$WORK/source.json" "$WORK/backup-after.json" "$WORK/problems.json" >"$WORK/manifest.json"
backup_s3 s3 cp --only-show-errors "$WORK/manifest.json" "s3://$R2_BUCKET/documents-manifests/documents-$stamp.json"

problems="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).join("\n"))' "$WORK/problems.json")"
if [[ -n "$problems" ]]; then
  echo "Some document records cannot be recovered from the backup:" >&2
  echo "$problems" >&2
  exit 1
fi
echo "Backed up $copied new file(s); every document record's file is in the backup."
