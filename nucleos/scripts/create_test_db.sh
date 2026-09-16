#!/usr/bin/env bash
# Build a Nucleos test database the RLS and pipeline suites can run against.
#
# Those suites skip unless TEST_DATABASE_URL points at a real PostgreSQL, and
# nothing in the repo said how to produce one — so they had never run, and the
# row-level security policies they exist to prove had never been verified.
#
#   ./scripts/create_test_db.sh                       # localhost:5432, db nucleos_test
#   PGPORT=55433 PGDATABASE=nucleos_test ./scripts/create_test_db.sh
#
# Then:
#   TEST_DATABASE_URL="postgresql+psycopg2://${PGUSER:-postgres}@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/${PGDATABASE:-nucleos_test}" \
#     pytest
#
# MIGRATION SETS — read this before changing the order below.
#
# The repo carries two overlapping sets and they do not compose:
#
#   supabase/migration.sql + db/migrations/     the base schema. Creates
#       cbam.audit_log, public.current_tenant_id() and the RLS policies the
#       isolation suite asserts on. Has no cbam_cpr_claims.
#
#   api/db/migrations/001-015                   a separate lineage. Adds
#       cpr_claims, registration, supplier tokens and verification fields, but
#       its 001 conflicts with the base schema and its later files assume
#       helpers the base schema provides.
#
# This script uses the first, because that is the one the RLS suite passes
# against. A case built this way cannot record a CPR claim, so
# TestCPRClaim::test_cpr_claim_persisted_and_readable_via_api fails here.
# Reconciling the two sets is a decision about which lineage is production's,
# and it needs someone who knows which one Supabase actually has. Do not guess:
# picking wrong silently changes what the RLS policies are.
set -euo pipefail

cd "$(dirname "$0")/.."

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-nucleos_test}"
export PGHOST PGPORT PGUSER

psql_maintenance() { psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql_test()        { psql -U "$PGUSER" -d "$PGDATABASE" "$@"; }

echo "Creating roles (Supabase's, which the RLS policies grant to) …"
psql_maintenance -q -c "DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END \$\$;"

echo "Recreating $PGDATABASE …"
psql_maintenance -q -c "DROP DATABASE IF EXISTS \"$PGDATABASE\" WITH (FORCE);"
psql_maintenance -q -c "CREATE DATABASE \"$PGDATABASE\";"

echo "Applying the base schema …"
psql_test -q -v ON_ERROR_STOP=1 -f supabase/migration.sql

echo "Applying db/migrations …"
for f in db/migrations/*.sql; do
  echo "  $(basename "$f")"
  psql_test -q -v ON_ERROR_STOP=1 -f "$f"
done

echo
echo "Done. Run the suite with:"
echo "  TEST_DATABASE_URL=\"postgresql+psycopg2://$PGUSER@$PGHOST:$PGPORT/$PGDATABASE\" pytest"
