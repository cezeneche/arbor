"""Arbor authenticates to Nucleos with its Vercel OIDC identity (to-do C3).

Arbor used to carry a year-long HS256 token that someone had to mint and set
by hand. Instead it now presents the short-lived OIDC token Vercel issues to
every Arbor function, exchanged for Nucleos's audience. Nucleos checks it
against Vercel's published keys and pins it to Arbor's team, project and
environment. What the token may do is decided here, never read from it.

The keys below are generated per test run; Vercel's JWKS endpoint is replaced
by serving them from PyJWKClient.fetch_data.
"""

from __future__ import annotations

import time

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm

from shared_auth import AuthContext, get_auth_context
from shared_auth.jwt import create_access_token, decode_bearer_token
from shared_auth import vercel_service

ISSUER = "https://oidc.vercel.com/test-team"
AUDIENCE = "https://nucleos.test"
OWNER_ID = "team_test"
PROJECT_ID = "prj_arbor"


def _key(kid: str):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = RSAAlgorithm.to_jwk(private.public_key(), as_dict=True)
    jwk.update({"kid": kid, "use": "sig", "alg": "RS256"})
    return private, jwk


VERCEL_KEY, VERCEL_JWK = _key("vercel-1")
STRANGER_KEY, _ = _key("stranger")


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    monkeypatch.setenv("NUCLEOS_SERVICE_OIDC_ISSUER", ISSUER)
    monkeypatch.setenv("NUCLEOS_SERVICE_OIDC_AUDIENCE", AUDIENCE)
    monkeypatch.setenv("NUCLEOS_SERVICE_OIDC_OWNER_ID", OWNER_ID)
    monkeypatch.setenv("NUCLEOS_SERVICE_OIDC_PROJECT_ID", PROJECT_ID)
    monkeypatch.delenv("NUCLEOS_SERVICE_OIDC_ENVIRONMENTS", raising=False)
    fetched: list[str] = []

    def fetch_data(self):
        fetched.append(self.uri)
        return {"keys": [VERCEL_JWK]}

    monkeypatch.setattr(pyjwt.PyJWKClient, "fetch_data", fetch_data)
    vercel_service.reset_key_cache()
    yield fetched
    vercel_service.reset_key_cache()


def _vercel_token(*, key=None, kid="vercel-1", alg="RS256", **overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": "owner:test-team:project:arbor:environment:production",
        "owner": "test-team",
        "owner_id": OWNER_ID,
        "project": "arbor",
        "project_id": PROJECT_ID,
        "environment": "production",
        "iat": now,
        "nbf": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return pyjwt.encode(claims, key or VERCEL_KEY, algorithm=alg, headers={"kid": kid})


def _rejected(token: str) -> None:
    with pytest.raises(ValueError, match="invalid_token"):
        decode_bearer_token(token)


class TestAccepted:
    def test_arbor_production_token_gets_the_service_grant(self, _configured):
        ctx = decode_bearer_token(_vercel_token())
        assert ctx.sub == "arbor-service"
        assert ctx.tenant_id == "arbor"
        assert set(ctx.scopes) == {"cbam:read", "cbam:write", "narrative:run"}
        assert _configured == [f"{ISSUER}/.well-known/jwks"]

    def test_scopes_in_the_token_are_ignored(self):
        ctx = decode_bearer_token(_vercel_token(scope="admin", scopes=["admin"], tenant_id="other"))
        assert "admin" not in ctx.scopes
        assert ctx.tenant_id == "arbor"

    def test_expiry_is_the_tokens_own(self):
        exp = int(time.time()) + 600
        assert decode_bearer_token(_vercel_token(exp=exp)).exp == exp

    def test_preview_accepted_only_when_listed(self, monkeypatch):
        preview = _vercel_token(environment="preview")
        _rejected(preview)
        monkeypatch.setenv("NUCLEOS_SERVICE_OIDC_ENVIRONMENTS", "production, preview")
        assert decode_bearer_token(preview).tenant_id == "arbor"

    def test_keys_are_fetched_once(self, _configured):
        decode_bearer_token(_vercel_token())
        decode_bearer_token(_vercel_token())
        assert len(_configured) == 1


class TestRejected:
    def test_wrong_audience(self):
        _rejected(_vercel_token(aud="https://vercel.com/test-team"))

    def test_another_project(self):
        _rejected(_vercel_token(project_id="prj_someone_else"))

    def test_another_team(self):
        _rejected(_vercel_token(owner_id="team_someone_else"))

    def test_development_token(self):
        _rejected(_vercel_token(environment="development"))

    def test_missing_environment(self):
        _rejected(_vercel_token(environment=None))

    def test_expired(self):
        now = int(time.time())
        _rejected(_vercel_token(iat=now - 7200, nbf=now - 7200, exp=now - 3600))

    def test_not_yet_valid(self):
        now = int(time.time())
        _rejected(_vercel_token(nbf=now + 3600))

    def test_signed_by_a_key_vercel_did_not_publish(self):
        _rejected(_vercel_token(key=STRANGER_KEY, kid="vercel-1"))

    def test_unknown_key_id(self):
        _rejected(_vercel_token(key=STRANGER_KEY, kid="stranger"))

    def test_hs256_with_vercel_issuer(self):
        # Algorithm confusion: an HMAC token claiming Vercel as its issuer.
        _rejected(_vercel_token(key="x" * 64, alg="HS256"))

    def test_vercel_token_when_not_configured(self, monkeypatch):
        monkeypatch.delenv("NUCLEOS_SERVICE_OIDC_PROJECT_ID")
        _rejected(_vercel_token())


class TestExistingTokensStillWork:
    def test_hs256_service_token(self):
        token, _ = create_access_token(sub="arbor-service", tenant_id="arbor", scopes=["cbam:read"])
        ctx = decode_bearer_token(token)
        assert (ctx.sub, ctx.tenant_id, ctx.scopes) == ("arbor-service", "arbor", ["cbam:read"])

    def test_garbage(self):
        _rejected("not-a-token")


def _app() -> TestClient:
    app = FastAPI()

    @app.get("/who")
    def who(ctx: AuthContext = Depends(get_auth_context)):  # noqa: B008
        return {"sub": ctx.sub, "tenant": ctx.tenant_id, "scopes": sorted(ctx.scopes)}

    return TestClient(app)


def test_route_dependency_accepts_the_vercel_token():
    r = _app().get("/who", headers={"Authorization": f"Bearer {_vercel_token()}"})
    assert r.status_code == 200
    assert r.json() == {"sub": "arbor-service", "tenant": "arbor", "scopes": ["cbam:read", "cbam:write", "narrative:run"]}


def test_route_dependency_refuses_another_project():
    r = _app().get("/who", headers={"Authorization": f"Bearer {_vercel_token(project_id='prj_x')}"})
    assert r.status_code == 401


def test_tenant_middleware_sets_the_tenant_from_the_vercel_token():
    from ledger_app.middleware.tenant_context import TenantContextMiddleware

    app = FastAPI()
    app.add_middleware(TenantContextMiddleware)

    @app.get("/api/cbam/probe")
    def probe(request: Request):
        auth = getattr(request.state, "auth", None)
        return {"tenant": auth.tenant_id if auth else None}

    r = TestClient(app).get("/api/cbam/probe", headers={"Authorization": f"Bearer {_vercel_token()}"})
    assert r.json() == {"tenant": "arbor"}
