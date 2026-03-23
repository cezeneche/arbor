"""
Supabase database connection module for nucleo-ledger.

Two clients are provided:

  supabase_admin  — initialised with SUPABASE_SERVICE_ROLE_KEY.
                    Bypasses RLS. Use for:
                    • Admin / migration operations
                    • Cross-tenant queries (reporting, analytics)
                    • Writing audit_log, cbam_snapshots (append-only tables)
                    • Reading cbam_emission_factors / cbam_electricity_factors

  supabase_anon   — initialised with SUPABASE_ANON_KEY.
                    RLS enforced via app.current_tenant_id session variable.
                    Use for all normal tenant-scoped CRUD from FastAPI routes.

The async PostgREST client (supabase-py ≥ 2.x) is used throughout.
For raw SQL (migrations, RLS set, stored procs) use the admin client's
.rpc() or .postgrest.session.execute() path shown below.
"""

import os
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from supabase import AsyncClient, acreate_client, AsyncClientOptions
from supabase.lib.client_options import AsyncClientOptions

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config — read from environment
# ---------------------------------------------------------------------------

SUPABASE_URL: str = os.environ["SUPABASE_URL"]
# Service-role key: full access, bypasses RLS
SUPABASE_SERVICE_ROLE_KEY: str = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
# Anon key: used with user JWTs; RLS is enforced
SUPABASE_ANON_KEY: str = os.environ.get("SUPABASE_ANON_KEY", "")

# ---------------------------------------------------------------------------
# Module-level client singletons (initialised in lifespan)
# ---------------------------------------------------------------------------

_admin_client: AsyncClient | None = None
_anon_client: AsyncClient | None = None


async def init_clients() -> None:
    """Call once at application startup (FastAPI lifespan)."""
    global _admin_client, _anon_client

    _admin_client = await acreate_client(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        options=AsyncClientOptions(
            schema="public",   # RPC calls (set_config etc.) live in public
            auto_refresh_token=False,
            persist_session=False,
        ),
    )
    logger.info("Supabase admin client initialised")

    if SUPABASE_ANON_KEY:
        _anon_client = await acreate_client(
            SUPABASE_URL,
            SUPABASE_ANON_KEY,
            options=AsyncClientOptions(
                schema="public",
                auto_refresh_token=False,
                persist_session=False,
            ),
        )
        logger.info("Supabase anon client initialised")


async def close_clients() -> None:
    """Call at application shutdown (FastAPI lifespan)."""
    global _admin_client, _anon_client
    # supabase-py AsyncClient has no explicit close; clear references
    _admin_client = None
    _anon_client = None
    logger.info("Supabase clients released")


# ---------------------------------------------------------------------------
# Accessors
# ---------------------------------------------------------------------------

def get_admin_client() -> AsyncClient:
    """Return the service-role client. Asserts it has been initialised."""
    if _admin_client is None:
        raise RuntimeError("Supabase admin client not initialised. Call init_clients() first.")
    return _admin_client


def get_anon_client() -> AsyncClient:
    """Return the anon client (RLS enforced via session var)."""
    if _anon_client is None:
        raise RuntimeError("Supabase anon client not initialised or SUPABASE_ANON_KEY not set.")
    return _anon_client


# ---------------------------------------------------------------------------
# FastAPI dependency — tenant-scoped client
# ---------------------------------------------------------------------------

async def get_tenant_client(tenant_id: str) -> AsyncGenerator[AsyncClient, None]:
    """
    FastAPI dependency that yields a Supabase client configured for a specific
    tenant. Uses the anon client so RLS is enforced, and sets the
    app.current_tenant_id session variable before yielding.

    Usage in a FastAPI route:

        from fastapi import Depends
        from database import get_tenant_client
        from shared_auth.dependencies import get_auth_context

        @router.get("/cases")
        async def list_cases(
            auth = Depends(get_auth_context),
            db   = Depends(lambda: get_tenant_client(auth.tenant_id)),
        ):
            result = await db.table("cbam_cases").select("*").execute()
            return result.data
    """
    client = get_anon_client()
    # Set tenant context so RLS policies resolve correctly
    await _set_tenant_context(client, tenant_id)
    try:
        yield client
    finally:
        # Clear tenant context after request
        await _clear_tenant_context(client)


@asynccontextmanager
async def admin_context():
    """
    Async context manager for admin (RLS-bypassing) operations.

    Usage:
        async with admin_context() as db:
            await db.table("cbam_emission_factors").select("*").execute()
    """
    yield get_admin_client()


# ---------------------------------------------------------------------------
# Tenant context helpers (raw SQL via RPC)
# ---------------------------------------------------------------------------

async def _set_tenant_context(client: AsyncClient, tenant_id: str) -> None:
    """
    Sets app.current_tenant_id for the current connection session.
    Called before every tenant-scoped request.
    """
    if not tenant_id:
        return
    try:
        await client.rpc(
            "set_config",
            {"setting": "app.current_tenant_id", "value": tenant_id, "is_local": True},
        ).execute()
    except Exception as exc:
        logger.warning("Failed to set tenant context for %s: %s", tenant_id, exc)


async def _clear_tenant_context(client: AsyncClient) -> None:
    """Clears app.current_tenant_id after the request completes."""
    try:
        await client.rpc(
            "set_config",
            {"setting": "app.current_tenant_id", "value": "", "is_local": True},
        ).execute()
    except Exception:
        pass  # Best-effort; connection will be returned to pool anyway


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

async def check_db_health() -> bool:
    """Returns True if the Supabase database is reachable."""
    try:
        client = get_admin_client()
        result = await client.rpc("pg_sleep", {"seconds": 0}).execute()
        return True
    except Exception as exc:
        logger.error("Supabase health check failed: %s", exc)
        return False


# ---------------------------------------------------------------------------
# FastAPI lifespan integration
# ---------------------------------------------------------------------------

from contextlib import asynccontextmanager as _acm
from fastapi import FastAPI


@_acm
async def supabase_lifespan(app: FastAPI):
    """
    Drop-in lifespan for FastAPI that initialises and tears down Supabase clients.

    Usage in main.py:

        from database import supabase_lifespan

        app = FastAPI(lifespan=supabase_lifespan)
    """
    await init_clients()
    yield
    await close_clients()
