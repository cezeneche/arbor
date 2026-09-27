"""
Tenant scoping on routes that did not check it, over HTTP against Postgres.

The audit-log route read any case's chain for any caller. Each test puts tenant
B against tenant A's data. (The legacy /api/cases routes, which had the same
problem, were removed on 27 September 2026 with the pre-integration pipeline.)
"""
# ruff: noqa: F811 — fixtures are imported from test_full_pipeline and requested by name.
from __future__ import annotations

from uuid import uuid4

from api.tests.test_full_pipeline import (  # noqa: F401 — fixtures are used by name
    _auth_headers,
    _post_case,
    api_client,
    cleanup_cases,
)


class TestAuditLogScoping:
    def test_audit_log_is_not_readable_by_another_tenant(self, api_client, cleanup_cases):
        case = _post_case(api_client, _auth_headers(str(uuid4())))
        cleanup_cases.append(case["id"])

        resp = api_client.get(
            f"/api/cases/{case['id']}/audit-log", headers=_auth_headers(str(uuid4()))
        )
        assert resp.status_code == 404

    def test_audit_log_is_readable_by_its_own_tenant(self, api_client, cleanup_cases):
        tenant = str(uuid4())
        case = _post_case(api_client, _auth_headers(tenant))
        cleanup_cases.append(case["id"])

        resp = api_client.get(f"/api/cases/{case['id']}/audit-log", headers=_auth_headers(tenant))
        assert resp.status_code == 200
        assert resp.json()["case_id"] == case["id"]


class TestTenantContext:
    """set_tenant_context feeds the RLS policies of either migration lineage.

    The base schema's policies read app.current_tenant_id (via
    public.current_tenant_id()); the other lineage's read app.tenant_id. The
    helper set only app.tenant_id, swallowed any error, and skipped an empty
    tenant — so on the base lineage the policies never saw the tenant at all.
    """

    def test_sets_both_settings_on_the_same_transaction(self, api_client):
        from ledger_app.api.cbam._shared import engine
        from ledger_app.db.rls import set_tenant_context
        from sqlalchemy import text

        tenant = str(uuid4())
        with engine.begin() as conn:
            set_tenant_context(conn, tenant)
            got = conn.execute(
                text("SELECT current_setting('app.current_tenant_id', true) AS a, "
                     "current_setting('app.tenant_id', true) AS b")
            ).mappings().one()
        assert (got["a"], got["b"]) == (tenant, tenant)

    def test_the_setting_does_not_outlive_its_transaction(self, api_client):
        from ledger_app.api.cbam._shared import engine
        from ledger_app.db.rls import set_tenant_context
        from sqlalchemy import text

        with engine.begin() as conn:
            set_tenant_context(conn, str(uuid4()))
        with engine.begin() as conn:
            got = conn.execute(text("SELECT current_setting('app.current_tenant_id', true)")).scalar()
        assert not got

    def test_refuses_an_empty_tenant(self, api_client):
        import pytest
        from ledger_app.api.cbam._shared import engine
        from ledger_app.db.rls import TenantContextError, set_tenant_context

        with engine.begin() as conn:
            with pytest.raises(TenantContextError):
                set_tenant_context(conn, "")
