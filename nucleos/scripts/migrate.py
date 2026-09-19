"""
Idempotent SQL migration runner.

Usage:
    python scripts/migrate.py

Environment:
    DATABASE_URL — PostgreSQL DSN (required, must be a psycopg2-compatible URL)

Behaviour:
    1. Connects to the database.
    2. Creates schema_migrations table if it doesn't exist.
    3. Applies the canonical lineage, in order: supabase/migration.sql (the
       base schema), then db/migrations/*.sql by numeric prefix. This is the
       same order scripts/create_test_db.sh builds the test database with,
       so production and the test suite run on one schema.
    4. Skips files already recorded in schema_migrations.
    5. Applies each pending file in a single transaction.
    6. Prints applied/skipped counts; exits 0 on success, 1 on failure.
"""

from __future__ import annotations

import glob
import os
import re
import sys

# ── 1. Resolve DATABASE_URL ───────────────────────────────────────────────────
database_url = os.getenv("DATABASE_URL", "").strip()
if not database_url:
    print("ERROR: DATABASE_URL environment variable is not set.", file=sys.stderr)
    sys.exit(1)

# Convert SQLAlchemy-style URL to plain psycopg2 DSN if needed.
dsn = database_url
if dsn.startswith("postgresql+psycopg2://"):
    dsn = dsn.replace("postgresql+psycopg2://", "postgresql://", 1)

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 is not installed. Run: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)

# ── 2. Connect ────────────────────────────────────────────────────────────────
try:
    conn = psycopg2.connect(dsn)
except Exception as exc:
    print(f"ERROR: Could not connect to database: {exc}", file=sys.stderr)
    sys.exit(1)

conn.autocommit = False
cur = conn.cursor()

# ── 3. Ensure tracking table exists ──────────────────────────────────────────
cur.execute(
    """
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """
)
conn.commit()

# 4. Discover migration files
repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_SCHEMA = os.path.join(repo_root, "supabase", "migration.sql")
MIGRATIONS_DIR = os.path.join(repo_root, "db", "migrations")


def _prefix(filepath: str) -> int:
    match = re.match(r"^(\d+)", os.path.basename(filepath))
    return int(match.group(1)) if match else 9999


files = [BASE_SCHEMA] + sorted(glob.glob(os.path.join(MIGRATIONS_DIR, "*.sql")), key=_prefix)
missing = [f for f in files if not os.path.isfile(f)]
if missing:
    print("ERROR: migration file(s) not found: " + ", ".join(missing), file=sys.stderr)
    conn.close()
    sys.exit(1)

# 5. Apply pending migrations
applied = 0
skipped = 0

for filepath in files:
    filename = os.path.basename(filepath)

    cur.execute("SELECT 1 FROM public.schema_migrations WHERE filename = %s", (filename,))
    if cur.fetchone():
        print(f"  skip  {filename}")
        skipped += 1
        continue

    print(f"  apply {filename} ...", end=" ", flush=True)
    try:
        with open(filepath, encoding="utf-8") as fh:
            sql = fh.read()
        # A migration can be comments only (004 records a divergence and
        # changes nothing); psycopg2 refuses an empty query, so record it
        # without executing.
        statements = "\n".join(
            line for line in sql.splitlines() if line.strip() and not line.strip().startswith("--")
        )
        if statements:
            cur.execute(sql)
        # Reset search_path in case the migration changed it (e.g. SET search_path TO cbam)
        cur.execute("SET search_path TO public")
        cur.execute(
            "INSERT INTO public.schema_migrations (filename) VALUES (%s)",
            (filename,),
        )
        conn.commit()
        print("ok")
        applied += 1
    except Exception as exc:
        conn.rollback()
        print(f"FAILED\nERROR applying {filename}: {exc}", file=sys.stderr)
        conn.close()
        sys.exit(1)

conn.close()
print(f"\nMigration complete: {applied} applied, {skipped} skipped.")
sys.exit(0)
