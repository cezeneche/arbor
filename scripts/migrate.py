"""
Idempotent SQL migration runner.

Usage:
    python scripts/migrate.py

Environment:
    DATABASE_URL — PostgreSQL DSN (required, must be a psycopg2-compatible URL)

Behaviour:
    1. Connects to the database.
    2. Creates schema_migrations table if it doesn't exist.
    3. Discovers *.sql files from two directories (in dependency order):
         - db/migrations/             (core public schema)
         - nucleo-ledger/db/migrations/ (CBAM schema)
       Files with the same numeric prefix are interleaved so that core
       migrations always run before their CBAM counterparts (e.g. core
       001_init.sql runs before ledger 001_add_cbam_tables.sql, ensuring
       cbam.cbam_cases exists before core 002_cbam_tenant_id.sql alters it).
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
    CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """
)
conn.commit()

# ── 4. Discover migration files ───────────────────────────────────────────────
repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Directories searched in priority order.  Within each numeric prefix group
# the directory's position in this list determines execution order — core
# migrations (index 0) run before CBAM migrations (index 1) so that the
# public schema exists before the cbam schema references it, and so that
# cbam.cbam_cases exists before core 002_cbam_tenant_id.sql alters it.
MIGRATION_DIRS = [
    os.path.join(repo_root, "db", "migrations"),
    os.path.join(repo_root, "nucleo-ledger", "db", "migrations"),
]


def _sort_key(filepath: str) -> tuple[int, int]:
    """Sort by (numeric prefix, source-dir priority) for correct dependency order."""
    filename = os.path.basename(filepath)
    match = re.match(r"^(\d+)", filename)
    prefix = int(match.group(1)) if match else 9999
    # Determine dir priority based on position in MIGRATION_DIRS list.
    for idx, mdir in enumerate(MIGRATION_DIRS):
        if filepath.startswith(mdir):
            return (prefix, idx)
    return (prefix, len(MIGRATION_DIRS))


all_files: list[str] = []
for mdir in MIGRATION_DIRS:
    if os.path.isdir(mdir):
        all_files.extend(glob.glob(os.path.join(mdir, "*.sql")))

files = sorted(all_files, key=_sort_key)

if not files:
    print("No migration files found in: " + ", ".join(MIGRATION_DIRS))
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
