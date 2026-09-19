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
# MIGRATION SETS
#
# The base lineage — supabase/migration.sql + db/migrations/ — is canonical.
# It is what the RLS suite passes against and what a new Nucleos database is
# built from. db/migrations/008 and 009 carry across everything from the older
# second lineage (api/db/migrations/, not applied) that the application writes
# to: CPR tables, case jurisdiction, consignment and verification fields,
# registration. The production database the second lineage may have described
# no longer exists (September 2026), so there was nothing to reconcile against.
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
