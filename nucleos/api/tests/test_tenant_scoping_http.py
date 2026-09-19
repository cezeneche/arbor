"""
Tenant scoping on routes that did not check it, over HTTP against Postgres.

The audit-log route read any case's chain for any caller. The legacy /api/cases
routes compared tenants only when both sides had one, matched ownership on the
JWT subject alone — which is not unique across tenants — and listed every
ownerless row in the database. Each test puts tenant B against tenant A's data.
"""
from __future__ import annotations

from uuid import uuid4

from api.tests.test_full_pipeline import (  # noqa: F401 — fixtures are used by name
    _auth_headers,
    _post_case,
    api_client,
    cleanup_cases,
)


def _legacy_case(tenant_id: str, owner_sub: str | None = "integration-test-user") -> dict:
    """A row in the legacy cases table, inserted directly.

    POST /api/cases also writes the legacy audit_log's prev_hmac column, which
    only one migration lineage has. Access control is what is under test here.
    """
    from ledger_app.api.cbam._shared import engine
    from sqlalchemy import text

    with engine.begin() as conn:
        row = conn.execute(
            text("""
                INSERT INTO cases (supplier_name, supplier_country, reporting_period_start,
                                   reporting_period_end, owner_sub, tenant_id)
                VALUES ('Tenant A Supplier', 'TR', '2027-01-01', '2027-03-31', :owner, :tenant)
                RETURNING id
            """),
            {"owner": owner_sub, "tenant": tenant_id},
        ).mappings().one()
    return {"id": str(row["id"])}


def _delete_legacy_case(case_id: str) -> None:
    from ledger_app.api.cbam._shared import engine
    from sqlalchemy import text

    with engine.begin() as conn:
        conn.execute(text("DELETE FROM case_acl WHERE case_id = :id"), {"id": case_id})
        conn.execute(text("DELETE FROM cases WHERE id = :id"), {"id": case_id})


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


class TestLegacyCasesScoping:
    def test_same_subject_in_another_tenant_is_not_the_owner(self, api_client):
        # Both tokens carry the same `sub`. Ownership is per tenant, not per subject.
        case = _legacy_case(str(uuid4()))
        try:
            resp = api_client.get(f"/api/cases/{case['id']}", headers=_auth_headers(str(uuid4())))
            assert resp.status_code == 404
        finally:
            _delete_legacy_case(case["id"])

    def test_list_does_not_include_another_tenants_cases(self, api_client):
        case = _legacy_case(str(uuid4()))
        try:
            resp = api_client.get("/api/cases", headers=_auth_headers(str(uuid4())))
            assert resp.status_code == 200
            assert case["id"] not in {c["id"] for c in resp.json()}
        finally:
            _delete_legacy_case(case["id"])

    def test_ownerless_row_in_another_tenant_is_not_readable(self, api_client):
        case = _legacy_case(str(uuid4()), owner_sub=None)
        try:
            other = _auth_headers(str(uuid4()), sub="someone-else")
            assert api_client.get(f"/api/cases/{case['id']}", headers=other).status_code == 404
            assert case["id"] not in {c["id"] for c in api_client.get("/api/cases", headers=other).json()}
        finally:
            _delete_legacy_case(case["id"])

    def test_own_tenant_still_reads_its_case(self, api_client):
        tenant = str(uuid4())
        case = _legacy_case(tenant)
        try:
            assert api_client.get(f"/api/cases/{case['id']}", headers=_auth_headers(tenant)).status_code == 200
            assert case["id"] in {c["id"] for c in api_client.get("/api/cases", headers=_auth_headers(tenant)).json()}
        finally:
            _delete_legacy_case(case["id"])


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
