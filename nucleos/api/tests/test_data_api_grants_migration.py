"""Migration 014: Supabase's Data API roles hold nothing on Nucleos tables.

Found in production on 31 October 2026: anon and authenticated still held
privileges on the tables in public (Supabase's old default for new tables) and
in cbam (granted by supabase/migration.sql). Nucleos never reads a table over
the Data API: it connects as the owner through the pooler and never switches
role, so those grants were only ever a way in around the application. They were
revoked by hand; 014 does the same everywhere else, and the base script no
longer grants them in the first place.

The database tests put the old grants back inside a transaction, run 014, check
the result, and roll back, so the test database is left as it was.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import pytest

_URL = os.getenv("TEST_DATABASE_URL", "")
needs_db = pytest.mark.skipif(not _URL, reason="needs TEST_DATABASE_URL (a real PostgreSQL)")

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "db" / "migrations" / "014_revoke_data_api_grants.sql"
BASE = ROOT / "supabase" / "migration.sql"
API_ROLES = ("anon", "authenticated")
SCHEMAS = ("public", "cbam")


@pytest.fixture
def cur():
    import psycopg2

    conn = psycopg2.connect(_URL.replace("postgresql+psycopg2://", "postgresql://", 1))
    cursor = conn.cursor()
    try:
        yield cursor
    finally:
        conn.rollback()
        conn.close()


def _restore_the_old_grants(cur) -> None:
    """What production had: everything on both schemas, now and for new tables."""
    for schema in SCHEMAS:
        cur.execute(f"GRANT USAGE ON SCHEMA {schema} TO anon, authenticated")
        cur.execute(f"GRANT ALL ON ALL TABLES IN SCHEMA {schema} TO anon, authenticated")
        cur.execute(f"GRANT ALL ON ALL SEQUENCES IN SCHEMA {schema} TO anon, authenticated")
        cur.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} GRANT ALL ON TABLES TO anon, authenticated")


def _tables_an_api_role_can_touch(cur) -> list[tuple[str, str, str]]:
    cur.execute(
        """
        SELECT r.role, n.nspname, c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN unnest(%s::text[]) AS r(role)
        WHERE n.nspname = ANY(%s) AND c.relkind IN ('r', 'p', 'v', 'S')
          AND CASE WHEN c.relkind = 'S'
                   THEN has_sequence_privilege(r.role, c.oid, 'USAGE,SELECT,UPDATE')
                   ELSE has_table_privilege(r.role, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              END
        ORDER BY 1, 2, 3
        """,
        (list(API_ROLES), list(SCHEMAS)),
    )
    return cur.fetchall()


@needs_db
def test_the_old_grants_expose_the_tables(cur):
    _restore_the_old_grants(cur)
    assert ("anon", "cbam", "cbam_cases") in _tables_an_api_role_can_touch(cur)


@needs_db
def test_migration_leaves_the_api_roles_nothing(cur):
    _restore_the_old_grants(cur)
    cur.execute(MIGRATION.read_text())
    assert _tables_an_api_role_can_touch(cur) == []
    for role in API_ROLES:
        cur.execute("SELECT has_schema_privilege(%s, 'cbam', 'USAGE')", (role,))
        assert cur.fetchone()[0] is False


@needs_db
def test_tables_created_later_are_not_exposed(cur):
    _restore_the_old_grants(cur)
    cur.execute(MIGRATION.read_text())
    cur.execute("CREATE TABLE public.zz_grants_probe (id int)")
    cur.execute("CREATE TABLE cbam.zz_grants_probe (id int)")
    assert _tables_an_api_role_can_touch(cur) == []


@needs_db
def test_service_role_keeps_its_access(cur):
    cur.execute(MIGRATION.read_text())
    cur.execute("SELECT has_table_privilege('service_role', 'cbam.cbam_cases', 'SELECT')")
    assert cur.fetchone()[0] is True


@needs_db
def test_migration_runs_twice(cur):
    cur.execute(MIGRATION.read_text())
    cur.execute(MIGRATION.read_text())
    assert _tables_an_api_role_can_touch(cur) == []


def test_the_base_script_grants_the_api_roles_nothing():
    # A rebuild from supabase/migration.sql must not hand the grants back.
    sql = re.sub(r"--.*$", "", BASE.read_text(), flags=re.M)
    granting = [
        " ".join(stmt.split())
        for stmt in sql.split(";")
        if re.search(r"\bGRANT\b", stmt)
        and not re.search(r"\bREVOKE\b", stmt)
        and re.search(r"\b(anon|authenticated)\b", stmt)
    ]
    assert granting == []
