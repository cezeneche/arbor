"""
Idempotent SQL migration runner.

Usage:
    python scripts/migrate.py

Environment:
    DATABASE_URL — PostgreSQL DSN (required, must be a psycopg2-compatible URL)

Behaviour:
    1. Connects to the database.
    2. Creates schema_migrations table if it doesn't exist.
    3. Globs db/migrations/*.sql sorted alphabetically.
    4. Skips files already recorded in schema_migrations.
    5. Applies each pending file in a single transaction.
    6. Prints applied/skipped counts; exits 0 on success, 1 on failure.
"""

from __future__ import annotations

import glob
import os
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
    CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """
)
conn.commit()

# ── 4. Discover migration files ───────────────────────────────────────────────
repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pattern = os.path.join(repo_root, "db", "migrations", "*.sql")
files = sorted(glob.glob(pattern))

if not files:
    print("No migration files found in db/migrations/")
    conn.close()
    sys.exit(0)

# ── 5. Apply pending migrations ───────────────────────────────────────────────
applied = 0
skipped = 0

for filepath in files:
    filename = os.path.basename(filepath)

    cur.execute("SELECT 1 FROM schema_migrations WHERE filename = %s", (filename,))
    if cur.fetchone():
        print(f"  skip  {filename}")
        skipped += 1
        continue

    print(f"  apply {filename} ...", end=" ", flush=True)
    try:
        with open(filepath, encoding="utf-8") as fh:
            sql = fh.read()
        cur.execute(sql)
        cur.execute(
            "INSERT INTO schema_migrations (filename) VALUES (%s)",
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
