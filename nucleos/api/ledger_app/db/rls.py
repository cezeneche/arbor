"""
Row-Level Security session helpers.

Call ``set_tenant_context(conn, tenant_id)`` at the start of any database
transaction that touches tenant-scoped tables (cases, cbam_cases, audit_log).

It sets both settings the RLS policies read, transaction-local, on the same
connection as the queries that follow: ``app.current_tenant_id`` (the base
schema's ``public.current_tenant_id()``) and ``app.tenant_id`` (the other
migration lineage's policies). Which lineage production runs is not yet
settled, and setting only one left the other's policies blind.

A no-op on non-PostgreSQL engines (SQLite in tests).
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

_POSTGRES_DIALECTS = ("postgresql", "psycopg2", "pg8000", "asyncpg")


class TenantContextError(RuntimeError):
    """Raised when a tenant-scoped transaction has no tenant to scope it to."""


def set_tenant_context(conn: Connection, tenant_id: str | None) -> None:
    """
    Scope the current PostgreSQL transaction to ``tenant_id`` for RLS.

    Raises ``TenantContextError`` for an empty tenant, and lets a failure to set
    the context propagate: a query that runs unscoped because the scoping
    silently failed is the failure RLS exists to prevent.
    """
    try:
        dialect = conn.dialect.name  # type: ignore[attr-defined]
    except AttributeError:
        dialect = ""
    if dialect not in _POSTGRES_DIALECTS:
        return

    if not tenant_id:
        raise TenantContextError("A tenant-scoped query was attempted with no tenant.")

    conn.execute(
        text(
            "SELECT set_config('app.current_tenant_id', :tid, true), "
            "set_config('app.tenant_id', :tid, true)"
        ),
        {"tid": str(tenant_id)},
    )
