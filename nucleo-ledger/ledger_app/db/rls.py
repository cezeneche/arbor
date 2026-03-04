"""
Row-Level Security session helpers.

Call ``set_tenant_context(conn, tenant_id)`` at the start of any database
transaction that touches tenant-scoped tables (cases, cbam_cases, audit_log).

This sets the PostgreSQL session variable ``app.tenant_id`` which the RLS
policies (migration 003) read via ``current_setting('app.tenant_id', true)``.

The helper is a no-op on non-PostgreSQL engines (SQLite in tests) so existing
test suites continue to work unchanged.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection


def set_tenant_context(conn: Connection, tenant_id: str | None) -> None:
    """
    Set ``app.tenant_id`` on the current PostgreSQL connection.

    Parameters
    ----------
    conn:
        An open SQLAlchemy ``Connection`` (inside a transaction context).
    tenant_id:
        The tenant identifier from the JWT ``tenant_id`` claim.
        ``None`` or ``""`` is silently skipped (legacy / system contexts bypass RLS).
    """
    if not tenant_id:
        return

    # Only run on PostgreSQL; SQLite and other backends don't support SET LOCAL.
    try:
        dialect = conn.dialect.name  # type: ignore[attr-defined]
    except AttributeError:
        dialect = ""

    if dialect not in ("postgresql", "psycopg2", "pg8000", "asyncpg"):
        return

    try:
        conn.execute(
            text("SET LOCAL app.tenant_id = :tid"),
            {"tid": str(tenant_id)},
        )
    except Exception:
        # Never raise — RLS set failure should surface as a policy violation on
        # the query itself, not as an unhandled exception here.
        pass
