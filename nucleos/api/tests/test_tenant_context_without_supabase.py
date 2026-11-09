"""The tenant middleware does not call Supabase when Supabase is not configured.

nucleos-api's SUPABASE_URL still pointed at the project lost in September
2026, so every authenticated request made two set_config calls to it, waited
for the 404s, and logged a warning. Those settings are being removed. Without
this guard the middleware would still try: importing the Supabase client
module raises KeyError when SUPABASE_URL is absent, which it caught and logged
as a warning on every request.
"""

from __future__ import annotations

import logging
import sys
import types

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from ledger_app.middleware import tenant_context
from ledger_app.middleware.tenant_context import TenantContextMiddleware
from shared_auth.testing import make_test_token


def _app() -> TestClient:
    app = FastAPI()
    app.add_middleware(TenantContextMiddleware)

    @app.get("/api/cbam/probe")
    def probe(request: Request):
        auth = getattr(request.state, "auth", None)
        return {"tenant": auth.tenant_id if auth else None}

    return TestClient(app)


def _fake_client_module(calls: list) -> types.ModuleType:
    """Stands in for ledger_app.db.supabase_client, recording each RPC."""

    class _Call:
        async def execute(self):
            return None

    class _Client:
        def rpc(self, name, params):
            calls.append((name, params))
            return _Call()

    module = types.ModuleType("ledger_app.db.supabase_client")
    module.get_admin_client = lambda: _Client()
    return module


def _get(client: TestClient):
    token = make_test_token(sub="arbor-service", tenant_id="arbor", scopes=["cbam:read"])
    return client.get("/api/cbam/probe", headers={"Authorization": f"Bearer {token}"})


def test_no_supabase_call_and_no_warning_without_supabase(monkeypatch, caplog):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    calls: list[str] = []
    monkeypatch.setitem(sys.modules, "ledger_app.db.supabase_client", _fake_client_module(calls))
    with caplog.at_level(logging.WARNING, logger=tenant_context.__name__):
        response = _get(_app())
    assert response.json() == {"tenant": "arbor"}
    assert calls == []
    assert not [r for r in caplog.records if "tenant context" in r.getMessage()]


def test_still_calls_supabase_when_it_is_configured(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    rpcs: list = []
    monkeypatch.setitem(sys.modules, "ledger_app.db.supabase_client", _fake_client_module(rpcs))

    assert _get(_app()).json() == {"tenant": "arbor"}
    assert [name for name, _ in rpcs] == ["set_config", "set_config"]
    assert rpcs[0][1]["value"] == "arbor"
