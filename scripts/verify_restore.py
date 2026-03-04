#!/usr/bin/env python3
"""
Smoke-test a restored database.

Checks:
  - Core tables exist (cases, audit_log, documents)
  - CBAM schema tables exist (cbam_cases, cbam_goods_lines, cbam_shipments)
  - Row counts > 0 for expected tables (warns but does not fail)
  - audit_log has at least one entry (warns if empty)

Exit code: 0 = pass, 1 = fail
"""
from __future__ import annotations

import os
import sys


REQUIRED_TABLES = [
    "cases",
    "audit_log",
    "documents",
]

CBAM_TABLES = [
    "cbam_cases",
    "cbam_goods_lines",
    "cbam_shipments",
]


def main() -> int:
    dsn = os.getenv("DATABASE_URL", "").strip()
    if not dsn:
        print("ERROR: DATABASE_URL is required.", file=sys.stderr)
        return 1

    try:
        import psycopg2
    except ImportError:
        print("ERROR: psycopg2 is not installed.", file=sys.stderr)
        return 1

    # Normalise DSN
    dsn = dsn.replace("postgresql+psycopg2://", "postgresql://").replace(
        "postgres+psycopg2://", "postgresql://"
    )

    failures = 0
    warnings = 0

    try:
        conn = psycopg2.connect(dsn)
        cur = conn.cursor()
    except Exception as e:
        print(f"FAIL: Cannot connect to database: {e}", file=sys.stderr)
        return 1

    # Check core tables
    for table in REQUIRED_TABLES:
        cur.execute(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = %s)",
            (table,),
        )
        exists = cur.fetchone()[0]
        if not exists:
            print(f"FAIL: Table '{table}' does not exist.")
            failures += 1
        else:
            print(f"OK:   Table '{table}' exists.")

    # Check CBAM schema tables
    for table in CBAM_TABLES:
        cur.execute(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
            "WHERE table_name = %s)",
            (table,),
        )
        exists = cur.fetchone()[0]
        if not exists:
            print(f"WARN: CBAM table '{table}' does not exist (may be uninitialised).")
            warnings += 1
        else:
            print(f"OK:   CBAM table '{table}' exists.")

    # Row count checks
    for table in REQUIRED_TABLES:
        try:
            cur.execute(f"SELECT COUNT(*) FROM {table}")  # noqa: S608
            count = cur.fetchone()[0]
            if count == 0:
                print(f"WARN: Table '{table}' is empty.")
                warnings += 1
            else:
                print(f"OK:   Table '{table}' has {count:,} row(s).")
        except Exception as e:
            print(f"WARN: Could not count rows in '{table}': {e}")
            warnings += 1

    conn.close()

    print()
    print(f"Result: {failures} failure(s), {warnings} warning(s).")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
