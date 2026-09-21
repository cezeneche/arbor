"""Opening the same case twice, over HTTP against Postgres.

Arbor posts a case and, when the request times out, offers to resume. The first
attempt can have succeeded server side — a cold start answering after the
client gave up is exactly what happened in production — so the resume posts the
same case again. A CBAM case is one importer's return for one period, so a
second row for the same importer and period is double counting, which the
admissibility rules treat as critical.

cbam_cases said so with a UNIQUE constraint on the encrypted importer_eori.
Fernet is randomised, so that constraint could never fire.
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


def test_posting_the_same_case_twice_returns_the_first_one(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))

    first = _post_case(api_client, headers)
    cleanup_cases.append(first["id"])
    second = _post_case(api_client, headers)

    assert second["id"] == first["id"]


def test_the_second_post_opens_no_second_row(api_client, cleanup_cases):
    from sqlalchemy import text

    from ledger_app.api.cbam._shared import engine

    tenant = str(uuid4())
    headers = _auth_headers(tenant)
    first = _post_case(api_client, headers)
    cleanup_cases.append(first["id"])
    _post_case(api_client, headers)

    with engine.begin() as conn:
        count = conn.execute(
            text("SELECT count(*) FROM cbam.cbam_cases WHERE tenant_id = :t"),
            {"t": tenant},
        ).scalar()
    assert count == 1


def test_a_different_period_is_a_different_case(api_client, cleanup_cases):
    headers = _auth_headers(str(uuid4()))

    first = _post_case(api_client, headers, reporting_year=2027)
    second = _post_case(api_client, headers, reporting_year=2028)
    cleanup_cases.extend([first["id"], second["id"]])

    assert first["id"] != second["id"]


def test_another_tenant_opens_its_own_case(api_client, cleanup_cases):
    # Idempotency must not reach across tenants: the same importer filing under
    # two tenants is two records, and returning one tenant's case to the other
    # would disclose it.
    first = _post_case(api_client, _auth_headers(str(uuid4())))
    second = _post_case(api_client, _auth_headers(str(uuid4())))
    cleanup_cases.extend([first["id"], second["id"]])

    assert first["id"] != second["id"]
