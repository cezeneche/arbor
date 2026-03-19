"""
test_tenant_isolation.py
========================
Integration tests that verify Supabase RLS (Row-Level Security) policies
correctly isolate tenant data in the Nucleos CBAM platform.

These tests run against a REAL Supabase database — they do NOT use mocks.
The goal is to verify that the actual RLS policies work correctly, not to
simulate them.

Required environment variables
-------------------------------
TEST_DATABASE_URL
    Direct PostgreSQL connection string to the Supabase test database.
    Use the Transaction Pooler URL from Supabase Settings → Database.
    Example:
      postgresql://postgres.ref:password@aws-0-eu-west-1.pooler.supabase.com:6543/postgres

TEST_SUPABASE_URL         (optional, for future PostgREST-layer tests)
TEST_SUPABASE_SERVICE_KEY (optional)

If TEST_DATABASE_URL is not set, all tests in this file are skipped.

How RLS is tested
-----------------
Each test uses two separate psycopg2 connections inside explicit transactions:

  admin_db  — no session variable set, runs as the superuser/service role.
              Used for setup (INSERT) and teardown (DELETE). Bypasses RLS.

  tenant_db — sets `SET LOCAL app.current_tenant_id = '<tenant_id>'` at the
              start of a transaction. All queries in that transaction are
              subject to RLS policies. This is exactly how the FastAPI
              middleware sets tenant context in production.

Why psycopg2 instead of supabase-py?
-------------------------------------
Supabase-py (PostgREST) does not guarantee session variable persistence
across requests due to connection pooling. For deterministic RLS testing,
we need a single psycopg2 connection where SET LOCAL is scoped to an
explicit transaction that we hold open for the duration of each assertion.
"""

from __future__ import annotations

import os
import uuid
from contextlib import contextmanager
from typing import Generator

import pytest

# ---------------------------------------------------------------------------
# Skip the entire module if TEST_DATABASE_URL is not configured
# ---------------------------------------------------------------------------

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason=(
        "TEST_DATABASE_URL not set — skipping RLS integration tests. "
        "Set TEST_DATABASE_URL to a Supabase transaction-pooler connection "
        "string to run these tests."
    ),
)

# ---------------------------------------------------------------------------
# Lazy import so the module can be collected even without psycopg2 installed
# ---------------------------------------------------------------------------

try:
    import psycopg2
    import psycopg2.extras
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL or not HAS_PSYCOPG2,
    reason="TEST_DATABASE_URL not set or psycopg2 not installed",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _connect() -> "psycopg2.connection":
    """Open a fresh psycopg2 connection to the Supabase test database."""
    return psycopg2.connect(TEST_DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


@contextmanager
def tenant_transaction(
    conn: "psycopg2.connection",
    tenant_id: str,
) -> Generator["psycopg2.cursor", None, None]:
    """Context manager that opens a transaction with app.current_tenant_id set.

    RLS policies read this variable.  Using SET LOCAL means the variable is
    automatically cleared when the transaction ends (commit or rollback).
    """
    conn.autocommit = False
    with conn.cursor() as cur:
        # Drop to the authenticated role so RLS is enforced.
        # The postgres superuser bypasses RLS by default; SET LOCAL ROLE
        # authenticated simulates how PostgREST executes queries in production.
        cur.execute("SET LOCAL ROLE authenticated")
        cur.execute(
            "SELECT set_config('app.current_tenant_id', %s, true)",
            (tenant_id,),
        )
        try:
            yield cur
            conn.commit()
        except Exception:
            conn.rollback()
            raise


@contextmanager
def admin_transaction(
    conn: "psycopg2.connection",
) -> Generator["psycopg2.cursor", None, None]:
    """Context manager for admin operations (no tenant context → bypasses RLS)."""
    conn.autocommit = False
    with conn.cursor() as cur:
        # Explicitly clear any lingering tenant context
        cur.execute("SELECT set_config('app.current_tenant_id', '', true)")
        try:
            yield cur
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def _new_id() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Module-scoped fixtures: one DB connection per tenant + one admin connection
# Two unique tenant IDs per test run (suffix prevents cross-run collisions)
# ---------------------------------------------------------------------------

RUN_SUFFIX = uuid.uuid4().hex[:8]
TENANT_A = f"rls-test-tenant-a-{RUN_SUFFIX}"
TENANT_B = f"rls-test-tenant-b-{RUN_SUFFIX}"


@pytest.fixture(scope="module")
def admin_db():
    """Admin connection — bypasses RLS, used for setup and teardown."""
    conn = _connect()
    yield conn
    conn.close()


@pytest.fixture(scope="module")
def tenant_a_db():
    conn = _connect()
    yield conn
    conn.close()


@pytest.fixture(scope="module")
def tenant_b_db():
    conn = _connect()
    yield conn
    conn.close()


# ---------------------------------------------------------------------------
# Shared test state — inserted once, cleaned up at module teardown
# ---------------------------------------------------------------------------

# Populated by the first test; read by subsequent tests
_state: dict = {}


@pytest.fixture(scope="module", autouse=True)
def seed_and_cleanup(admin_db):
    """Insert test rows as admin (bypasses RLS) before all tests in this module,
    then delete them after all tests complete."""

    case_id_a  = _new_id()
    case_id_a2 = _new_id()  # second case for tenant_a
    doc_id_a   = _new_id()
    audit_id_a = _new_id()

    _state.update(
        case_id_a=case_id_a,
        case_id_a2=case_id_a2,
        doc_id_a=doc_id_a,
        audit_id_a=audit_id_a,
    )

    with admin_transaction(admin_db) as cur:
        # --- cbam_cases ---
        cur.execute(
            """
            INSERT INTO cbam.cbam_cases
                (id, tenant_id, importer_eori, importer_name,
                 reporting_year, reporting_quarter, status)
            VALUES
                (%s, %s, 'GB100000000001', 'Tenant A Steel GmbH', 2025, 1, 'draft'),
                (%s, %s, 'GB100000000002', 'Tenant A Cement Ltd', 2025, 2, 'submitted')
            """,
            (case_id_a, TENANT_A, case_id_a2, TENANT_A),
        )

        # --- cbam.documents (using cbam schema documents table) ---
        cur.execute(
            """
            INSERT INTO cbam.documents
                (id, tenant_id, case_id, filename, storage_key)
            VALUES
                (%s, %s, %s, 'invoice_a.pdf', 'rls-test/invoice_a.pdf')
            """,
            (doc_id_a, TENANT_A, case_id_a),
        )

        # --- cbam.audit_log ---
        cur.execute(
            """
            INSERT INTO cbam.audit_log
                (id, tenant_id, case_id, event_type, actor, payload)
            VALUES
                (%s, %s, %s, 'case_created', 'test-user-a', '{"test": true}'::jsonb)
            """,
            (audit_id_a, TENANT_A, case_id_a),
        )

    yield  # ← all tests run here

    # Teardown — delete in reverse FK order
    with admin_transaction(admin_db) as cur:
        cur.execute(
            "DELETE FROM cbam.audit_log WHERE tenant_id IN (%s, %s)",
            (TENANT_A, TENANT_B),
        )
        cur.execute(
            "DELETE FROM cbam.documents WHERE tenant_id IN (%s, %s)",
            (TENANT_A, TENANT_B),
        )
        cur.execute(
            "DELETE FROM cbam.cbam_cases WHERE tenant_id IN (%s, %s)",
            (TENANT_A, TENANT_B),
        )


# ===========================================================================
# TEST GROUP 1 — cbam_cases isolation
# ===========================================================================

class TestCbamCasesRLS:

    def test_tenant_a_can_read_own_cases(self, tenant_a_db):
        """Tenant A must see exactly the 2 cases seeded for it."""
        with tenant_transaction(tenant_a_db, TENANT_A) as cur:
            cur.execute(
                "SELECT id FROM cbam.cbam_cases WHERE tenant_id = %s",
                (TENANT_A,),
            )
            rows = cur.fetchall()

        ids = {r["id"] for r in rows}
        assert _state["case_id_a"]  in ids, "First tenant_a case not visible to tenant_a"
        assert _state["case_id_a2"] in ids, "Second tenant_a case not visible to tenant_a"

    def test_tenant_b_sees_zero_cases(self, tenant_b_db):
        """Tenant B must see no cases — all rows belong to tenant_a."""
        with tenant_transaction(tenant_b_db, TENANT_B) as cur:
            cur.execute("SELECT id FROM cbam.cbam_cases")
            rows = cur.fetchall()

        assert rows == [], (
            f"RLS VIOLATION: tenant_b can see {len(rows)} case(s) belonging to tenant_a. "
            f"IDs: {[r['id'] for r in rows]}"
        )

    def test_tenant_b_cannot_read_specific_tenant_a_case(self, tenant_b_db):
        """Fetching tenant_a's case ID explicitly as tenant_b must return nothing."""
        with tenant_transaction(tenant_b_db, TENANT_B) as cur:
            cur.execute(
                "SELECT id FROM cbam.cbam_cases WHERE id = %s",
                (_state["case_id_a"],),
            )
            row = cur.fetchone()

        assert row is None, (
            "RLS VIOLATION: tenant_b can read tenant_a's case by explicit ID. "
            f"Row returned: {row}"
        )

    def test_tenant_b_update_is_silently_blocked(self, tenant_b_db):
        """UPDATE by tenant_b on tenant_a's row must affect 0 rows (RLS USING blocks it)."""
        with tenant_transaction(tenant_b_db, TENANT_B) as cur:
            cur.execute(
                """
                UPDATE cbam.cbam_cases
                SET status = 'approved'
                WHERE id = %s
                """,
                (_state["case_id_a"],),
            )
            affected = cur.rowcount

        assert affected == 0, (
            f"RLS VIOLATION: tenant_b UPDATE affected {affected} row(s) on tenant_a data. "
            "Expected 0 rows updated."
        )

    def test_tenant_b_update_did_not_mutate_data(self, admin_db):
        """Confirm at admin level that the blocked UPDATE left the row unchanged."""
        with admin_transaction(admin_db) as cur:
            cur.execute(
                "SELECT status FROM cbam.cbam_cases WHERE id = %s",
                (_state["case_id_a"],),
            )
            row = cur.fetchone()

        assert row is not None
        assert row["status"] == "draft", (
            f"Data was mutated despite RLS block. status={row['status']!r} (expected 'draft')"
        )

    def test_tenant_b_insert_with_wrong_tenant_id_is_blocked(self, tenant_b_db):
        """Tenant_b must not be able to INSERT a row claiming to be tenant_a."""
        spoofed_id = _new_id()
        with pytest.raises(Exception) as exc_info:
            with tenant_transaction(tenant_b_db, TENANT_B) as cur:
                cur.execute(
                    """
                    INSERT INTO cbam.cbam_cases
                        (id, tenant_id, importer_eori, reporting_year, reporting_quarter, status)
                    VALUES (%s, %s, 'GB999999999', 2025, 3, 'draft')
                    """,
                    (spoofed_id, TENANT_A),   # ← spoofing tenant_a
                )

        # RLS WITH CHECK will reject this insert
        assert exc_info.value is not None, (
            "RLS VIOLATION: tenant_b successfully inserted a row with tenant_id = tenant_a"
        )

    def test_tenant_a_insert_and_read_roundtrip(self, tenant_a_db):
        """Tenant_a can insert a new case and immediately read it back."""
        new_id = _new_id()
        with tenant_transaction(tenant_a_db, TENANT_A) as cur:
            cur.execute(
                """
                INSERT INTO cbam.cbam_cases
                    (id, tenant_id, importer_eori, reporting_year, reporting_quarter, status)
                VALUES (%s, %s, 'GB200000000001', 2025, 4, 'draft')
                """,
                (new_id, TENANT_A),
            )
            cur.execute(
                "SELECT id, tenant_id FROM cbam.cbam_cases WHERE id = %s",
                (new_id,),
            )
            row = cur.fetchone()

        assert row is not None, "Tenant_a could not read back its own newly inserted case"
        assert row["tenant_id"] == TENANT_A
        assert row["id"] == new_id

        # Cleanup the extra row
        with admin_transaction(tenant_a_db) as cur:
            cur.execute("DELETE FROM cbam.cbam_cases WHERE id = %s", (new_id,))


# ===========================================================================
# TEST GROUP 2 — documents isolation
# ===========================================================================

class TestDocumentsRLS:

    def test_tenant_a_can_read_own_document(self, tenant_a_db):
        with tenant_transaction(tenant_a_db, TENANT_A) as cur:
            cur.execute(
                "SELECT id FROM cbam.documents WHERE id = %s",
                (_state["doc_id_a"],),
            )
            row = cur.fetchone()

        assert row is not None, "Tenant_a cannot read its own document"
        assert row["id"] == _state["doc_id_a"]

    def test_tenant_b_cannot_see_tenant_a_documents(self, tenant_b_db):
        with tenant_transaction(tenant_b_db, TENANT_B) as cur:
            cur.execute("SELECT id FROM cbam.documents")
            rows = cur.fetchall()

        assert rows == [], (
            f"RLS VIOLATION: tenant_b can see {len(rows)} document(s) belonging to tenant_a"
        )

    def test_tenant_b_cannot_fetch_document_by_id(self, tenant_b_db):
        with tenant_transaction(tenant_b_db, TENANT_B) as cur:
            cur.execute(
                "SELECT id FROM cbam.documents WHERE id = %s",
                (_state["doc_id_a"],),
            )
            row = cur.fetchone()

        assert row is None, (
            f"RLS VIOLATION: tenant_b fetched tenant_a's document by ID. Row: {row}"
        )

    def test_tenant_b_cannot_delete_tenant_a_document(self, tenant_b_db):
        with tenant_transaction(tenant_b_db, TENANT_B) as cur:
            cur.execute(
                "DELETE FROM cbam.documents WHERE id = %s",
                (_state["doc_id_a"],),
            )
            affected = cur.rowcount

        assert affected == 0, (
            f"RLS VIOLATION: tenant_b deleted {affected} document(s) belonging to tenant_a"
        )

    def test_document_still_exists_after_blocked_delete(self, admin_db):
        """Confirm at admin level that the blocked DELETE left the document intact."""
        with admin_transaction(admin_db) as cur:
            cur.execute(
                "SELECT id FROM cbam.documents WHERE id = %s",
                (_state["doc_id_a"],),
            )
            row = cur.fetchone()

        assert row is not None, (
            "Document was deleted despite RLS block — data loss detected"
        )


# ===========================================================================
# TEST GROUP 3 — audit_log isolation (append-only, tenant-readable only)
# ===========================================================================

class TestAuditLogRLS:

    def test_tenant_a_can_read_own_audit_events(self, tenant_a_db):
        with tenant_transaction(tenant_a_db, TENANT_A) as cur:
            cur.execute(
                "SELECT id FROM cbam.audit_log WHERE id = %s",
                (_state["audit_id_a"],),
            )
            row = cur.fetchone()

        assert row is not None, "Tenant_a cannot read its own audit log entry"

    def test_tenant_b_cannot_see_tenant_a_audit_events(self, tenant_b_db):
        with tenant_transaction(tenant_b_db, TENANT_B) as cur:
            cur.execute("SELECT id FROM cbam.audit_log")
            rows = cur.fetchall()

        assert rows == [], (
            f"RLS VIOLATION: tenant_b can read {len(rows)} audit event(s) belonging to tenant_a"
        )

    def test_tenant_b_cannot_read_audit_event_by_id(self, tenant_b_db):
        with tenant_transaction(tenant_b_db, TENANT_B) as cur:
            cur.execute(
                "SELECT id FROM cbam.audit_log WHERE id = %s",
                (_state["audit_id_a"],),
            )
            row = cur.fetchone()

        assert row is None, (
            f"RLS VIOLATION: tenant_b read tenant_a's audit event by explicit ID. Row: {row}"
        )

    def test_audit_log_has_no_update_policy(self, tenant_a_db):
        """Even the owning tenant cannot UPDATE audit log rows (append-only)."""
        with tenant_transaction(tenant_a_db, TENANT_A) as cur:
            cur.execute(
                "UPDATE cbam.audit_log SET event_type = 'tampered' WHERE id = %s",
                (_state["audit_id_a"],),
            )
            affected = cur.rowcount

        assert affected == 0, (
            f"APPEND-ONLY VIOLATION: tenant_a updated {affected} audit log row(s). "
            "No UPDATE policy should exist on audit_log."
        )

    def test_audit_log_event_type_unchanged(self, admin_db):
        """Confirm the audit event was not mutated by the blocked UPDATE."""
        with admin_transaction(admin_db) as cur:
            cur.execute(
                "SELECT event_type FROM cbam.audit_log WHERE id = %s",
                (_state["audit_id_a"],),
            )
            row = cur.fetchone()

        assert row is not None
        assert row["event_type"] == "case_created", (
            f"Audit event was mutated. event_type={row['event_type']!r} (expected 'case_created')"
        )

    def test_tenant_b_cannot_delete_audit_event(self, tenant_b_db):
        with tenant_transaction(tenant_b_db, TENANT_B) as cur:
            cur.execute(
                "DELETE FROM cbam.audit_log WHERE id = %s",
                (_state["audit_id_a"],),
            )
            affected = cur.rowcount

        assert affected == 0, (
            f"RLS VIOLATION: tenant_b deleted {affected} audit event(s) belonging to tenant_a"
        )

    def test_tenant_a_cannot_delete_own_audit_event(self, tenant_a_db):
        """No tenant can delete audit events — no DELETE policy on audit_log."""
        with tenant_transaction(tenant_a_db, TENANT_A) as cur:
            cur.execute(
                "DELETE FROM cbam.audit_log WHERE id = %s",
                (_state["audit_id_a"],),
            )
            affected = cur.rowcount

        assert affected == 0, (
            f"APPEND-ONLY VIOLATION: tenant_a deleted {affected} of its own audit events. "
            "Audit log must be immutable."
        )

    def test_tenant_b_can_insert_own_audit_event(self, tenant_b_db, admin_db):
        """Tenant_b should be able to INSERT its own audit events."""
        new_id = _new_id()
        with tenant_transaction(tenant_b_db, TENANT_B) as cur:
            cur.execute(
                """
                INSERT INTO cbam.audit_log
                    (id, tenant_id, case_id, event_type, actor, payload)
                VALUES (%s, %s, NULL, 'test_event', 'test-user-b', '{}'::jsonb)
                """,
                (new_id, TENANT_B),
            )

        # Verify it exists at admin level
        with admin_transaction(admin_db) as cur:
            cur.execute("SELECT id, tenant_id FROM cbam.audit_log WHERE id = %s", (new_id,))
            row = cur.fetchone()

        assert row is not None, "Tenant_b's audit event was not inserted"
        assert row["tenant_id"] == TENANT_B

        # Cleanup
        with admin_transaction(admin_db) as cur:
            cur.execute("DELETE FROM cbam.audit_log WHERE id = %s", (new_id,))


# ===========================================================================
# TEST GROUP 4 — cross-tenant write attempts (spoofing attacks)
# ===========================================================================

class TestCrossTenantSpoofing:

    def test_tenant_b_cannot_spoof_tenant_a_in_case_insert(self, tenant_b_db):
        """Tenant_b must not be able to INSERT a case claiming tenant_a's ID."""
        spoofed_id = _new_id()
        blocked = False
        try:
            with tenant_transaction(tenant_b_db, TENANT_B) as cur:
                cur.execute(
                    """
                    INSERT INTO cbam.cbam_cases
                        (id, tenant_id, importer_eori, reporting_year, reporting_quarter, status)
                    VALUES (%s, %s, 'GB-SPOOF', 2025, 1, 'draft')
                    """,
                    (spoofed_id, TENANT_A),
                )
        except Exception:
            blocked = True

        assert blocked, (
            "RLS VIOLATION: tenant_b successfully inserted a cbam_case with "
            f"tenant_id='{TENANT_A}'. WITH CHECK policy did not block it."
        )

    def test_tenant_b_cannot_spoof_tenant_a_in_document_insert(self, tenant_b_db):
        """Tenant_b must not be able to INSERT a document claiming tenant_a's ID."""
        spoofed_id = _new_id()
        blocked = False
        try:
            with tenant_transaction(tenant_b_db, TENANT_B) as cur:
                cur.execute(
                    """
                    INSERT INTO cbam.documents
                        (id, tenant_id, case_id, filename, storage_key)
                    VALUES (%s, %s, %s, 'spoof.pdf', 'rls-test/spoof.pdf')
                    """,
                    (spoofed_id, TENANT_A, _state["case_id_a"]),
                )
        except Exception:
            blocked = True

        assert blocked, (
            "RLS VIOLATION: tenant_b inserted a document into tenant_a's case. "
            "WITH CHECK policy did not block it."
        )

    def test_tenant_b_cannot_spoof_audit_event_for_tenant_a(self, tenant_b_db):
        """Tenant_b must not be able to INSERT an audit event with tenant_a's ID."""
        spoofed_id = _new_id()
        blocked = False
        try:
            with tenant_transaction(tenant_b_db, TENANT_B) as cur:
                cur.execute(
                    """
                    INSERT INTO cbam.audit_log
                        (id, tenant_id, case_id, event_type, actor, payload)
                    VALUES (%s, %s, %s, 'spoof_event', 'attacker', '{}'::jsonb)
                    """,
                    (spoofed_id, TENANT_A, _state["case_id_a"]),
                )
        except Exception:
            blocked = True

        assert blocked, (
            "RLS VIOLATION: tenant_b inserted an audit event with tenant_id=tenant_a. "
            "WITH CHECK policy did not block it."
        )


# ===========================================================================
# TEST GROUP 5 — admin / service role bypasses RLS (sanity check)
# ===========================================================================

class TestAdminBypassesRLS:

    def test_admin_can_see_all_cases(self, admin_db):
        """Admin connection (no tenant context) must see all test cases."""
        with admin_transaction(admin_db) as cur:
            cur.execute(
                "SELECT id FROM cbam.cbam_cases WHERE tenant_id IN (%s, %s)",
                (TENANT_A, TENANT_B),
            )
            rows = cur.fetchall()

        ids = {r["id"] for r in rows}
        assert _state["case_id_a"]  in ids
        assert _state["case_id_a2"] in ids

    def test_admin_can_see_all_documents(self, admin_db):
        with admin_transaction(admin_db) as cur:
            cur.execute(
                "SELECT id FROM cbam.documents WHERE tenant_id = %s",
                (TENANT_A,),
            )
            rows = cur.fetchall()

        assert any(r["id"] == _state["doc_id_a"] for r in rows)

    def test_admin_can_see_all_audit_events(self, admin_db):
        with admin_transaction(admin_db) as cur:
            cur.execute(
                "SELECT id FROM cbam.audit_log WHERE tenant_id = %s",
                (TENANT_A,),
            )
            rows = cur.fetchall()

        assert any(r["id"] == _state["audit_id_a"] for r in rows)
