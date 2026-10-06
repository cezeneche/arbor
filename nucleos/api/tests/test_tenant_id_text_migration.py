"""Migration 013: every CBAM tenant_id column is TEXT.

Found in production on 6 October 2026: opening carbon price relief failed with
`invalid input syntax for type uuid: "arbor"`. The production database still
had cbam_cpr_claims as the old second lineage created it, with tenant_id UUID.
Migration 008 meant to bring the table across as TEXT, but it is written
`CREATE TABLE IF NOT EXISTS`, so on a database that already had the table it
changed nothing. Arbor's tenant in Nucleos is the text "arbor", and a UUID
column can neither store it nor be compared with it. cbam_registration and
cbam_threshold_alerts came from the same lineage (migration 009).

These tests put the tables back into that old shape inside a transaction, run
013, check the result, and roll back, so the test database is left as it was.
Readiness now reports the mismatch too: it said "schema: ok" throughout.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

_URL = os.getenv("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not _URL, reason="needs TEST_DATABASE_URL (a real PostgreSQL)")

MIGRATION = Path(__file__).resolve().parents[2] / "db" / "migrations" / "013_tenant_id_text.sql"
TABLES = ("cbam_cpr_claims", "cbam_registration", "cbam_threshold_alerts")


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


def _tenant_type(cur, table: str) -> str:
    cur.execute(
        "SELECT data_type FROM information_schema.columns "
        "WHERE table_schema = 'cbam' AND table_name = %s AND column_name = 'tenant_id'",
        (table,),
    )
    return cur.fetchone()[0]


def _policies(cur, table: str) -> set[str]:
    cur.execute("SELECT policyname FROM pg_policies WHERE schemaname = 'cbam' AND tablename = %s", (table,))
    return {row[0] for row in cur.fetchall()}


def _make_like_the_old_lineage(cur) -> None:
    """UUID tenant_id and no tenant policies, as production had."""
    for table in TABLES:
        cur.execute(f"DELETE FROM cbam.{table}")
        for policy in _policies(cur, table):
            cur.execute(f'DROP POLICY "{policy}" ON cbam.{table}')
        cur.execute(f"ALTER TABLE cbam.{table} ALTER COLUMN tenant_id TYPE UUID USING tenant_id::uuid")


def test_the_old_shape_rejects_arbors_tenant(cur):
    _make_like_the_old_lineage(cur)
    import psycopg2

    cur.execute("SAVEPOINT before")
    with pytest.raises(psycopg2.errors.InvalidTextRepresentation):
        cur.execute("SELECT * FROM cbam.cbam_cpr_claims WHERE tenant_id = %s", ("arbor",))
    cur.execute("ROLLBACK TO SAVEPOINT before")


def test_migration_makes_every_tenant_id_text(cur):
    _make_like_the_old_lineage(cur)
    cur.execute(MIGRATION.read_text())
    for table in TABLES:
        assert _tenant_type(cur, table) == "text", table
    # The query that failed in production.
    cur.execute("SELECT * FROM cbam.cbam_cpr_claims WHERE tenant_id = %s", ("arbor",))
    assert cur.fetchall() == []


def test_migration_restores_the_claims_policies(cur):
    _make_like_the_old_lineage(cur)
    cur.execute(MIGRATION.read_text())
    assert {"cbam_cpr_claims_tenant_select", "cbam_cpr_claims_tenant_insert"} <= _policies(cur, "cbam_cpr_claims")
    cur.execute("SELECT relrowsecurity FROM pg_class WHERE oid = 'cbam.cbam_cpr_claims'::regclass")
    assert cur.fetchone()[0] is True


def test_migration_keeps_another_tables_own_policies(cur):
    # Production's registration and alerts tables may carry policies this
    # lineage never defined. They are dropped to change the column, and must
    # come back as they were.
    _make_like_the_old_lineage(cur)
    cur.execute("ALTER TABLE cbam.cbam_registration ENABLE ROW LEVEL SECURITY")
    cur.execute(
        "CREATE POLICY registration_own_rows ON cbam.cbam_registration "
        "FOR SELECT USING (tenant_id IS NOT NULL)"
    )
    cur.execute(
        "CREATE POLICY registration_writes ON cbam.cbam_registration "
        "AS RESTRICTIVE FOR INSERT WITH CHECK (tenant_id IS NOT NULL)"
    )
    cur.execute(MIGRATION.read_text())
    assert _tenant_type(cur, "cbam_registration") == "text"
    cur.execute(
        "SELECT policyname, permissive, cmd, qual, with_check FROM pg_policies "
        "WHERE schemaname = 'cbam' AND tablename = 'cbam_registration' ORDER BY policyname"
    )
    assert cur.fetchall() == [
        ("registration_own_rows", "PERMISSIVE", "SELECT", "(tenant_id IS NOT NULL)", None),
        ("registration_writes", "RESTRICTIVE", "INSERT", None, "(tenant_id IS NOT NULL)"),
    ]


def test_migration_changes_nothing_on_a_correct_database(cur):
    before = {t: (_tenant_type(cur, t), _policies(cur, t)) for t in TABLES}
    cur.execute(MIGRATION.read_text())
    cur.execute(MIGRATION.read_text())  # and is safe to run twice
    assert {t: (_tenant_type(cur, t), _policies(cur, t)) for t in TABLES} == before


def test_readiness_names_a_tenant_column_of_the_wrong_type(cur):
    from ledger_app.db.session import tenant_columns_of_wrong_type

    assert tenant_columns_of_wrong_type() == []
    _make_like_the_old_lineage(cur)
    cur.connection.commit()  # readiness reads on its own connection
    try:
        assert tenant_columns_of_wrong_type() == [
            "cbam.cbam_cpr_claims.tenant_id is uuid",
            "cbam.cbam_registration.tenant_id is uuid",
            "cbam.cbam_threshold_alerts.tenant_id is uuid",
        ]
    finally:
        cur.execute(MIGRATION.read_text())
        cur.connection.commit()
