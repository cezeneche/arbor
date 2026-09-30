"""Arbor's service identity: its Vercel OIDC token.

Arbor used to authenticate with a year-long HS256 token that someone had to
mint and set by hand. It now presents the OIDC token Vercel issues to each of
its functions (valid about two hours, refreshed by Vercel), exchanged for
Nucleos's audience so it is useless anywhere else. Nothing to renew, and no
Nucleos secret held by Arbor.

A token is accepted only when every one of these holds:
  - signed RS256 by a key in the issuer's published JWKS;
  - ``iss`` is the configured Vercel team issuer, ``aud`` is Nucleos's audience;
  - ``owner_id`` and ``project_id`` are Arbor's team and project (IDs, not
    names, so a rename can't spoof or break them);
  - ``environment`` is one Nucleos allows (production unless told otherwise:
    preview deployments run unreviewed branches).

What the token may do is the grant below, fixed here. Claims in the token such
as ``scope`` are ignored.

Environment:
    NUCLEOS_SERVICE_OIDC_ISSUER        e.g. https://oidc.vercel.com/<team-slug>
    NUCLEOS_SERVICE_OIDC_AUDIENCE      the audience Arbor exchanges for
    NUCLEOS_SERVICE_OIDC_OWNER_ID      Arbor's Vercel team ID (team_…)
    NUCLEOS_SERVICE_OIDC_PROJECT_ID    Arbor's Vercel project ID (prj_…)
    NUCLEOS_SERVICE_OIDC_ENVIRONMENTS  optional, comma-separated; default "production"

All four required values unset → this path is off, and a Vercel token is
refused like any other token Nucleos can't verify.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import jwt as pyjwt

from shared_auth.models import AuthContext

_log = logging.getLogger("shared_auth.vercel_service")

# The Arbor service grant. Matches the HS256 token it replaces.
SERVICE_SUBJECT = "arbor-service"
SERVICE_TENANT = "arbor"
SERVICE_SCOPES = ("cbam:read", "cbam:write", "narrative:run")

_LEEWAY_SECONDS = 30
_KEY_CACHE_SECONDS = 3600

_clients: dict[str, pyjwt.PyJWKClient] = {}


@dataclass(frozen=True)
class _Settings:
    issuer: str
    audience: str
    owner_id: str
    project_id: str
    environments: frozenset[str]

    @property
    def jwks_url(self) -> str:
        return f"{self.issuer.rstrip('/')}/.well-known/jwks"


def _settings() -> _Settings | None:
    issuer = os.getenv("NUCLEOS_SERVICE_OIDC_ISSUER", "").strip()
    audience = os.getenv("NUCLEOS_SERVICE_OIDC_AUDIENCE", "").strip()
    owner_id = os.getenv("NUCLEOS_SERVICE_OIDC_OWNER_ID", "").strip()
    project_id = os.getenv("NUCLEOS_SERVICE_OIDC_PROJECT_ID", "").strip()
    if not (issuer and audience and owner_id and project_id):
        return None
    if not issuer.startswith("https://"):
        _log.error("NUCLEOS_SERVICE_OIDC_ISSUER must be an https URL; service OIDC is off")
        return None
    envs = os.getenv("NUCLEOS_SERVICE_OIDC_ENVIRONMENTS", "production")
    return _Settings(
        issuer=issuer,
        audience=audience,
        owner_id=owner_id,
        project_id=project_id,
        environments=frozenset(e.strip() for e in envs.split(",") if e.strip()),
    )


def reset_key_cache() -> None:
    _clients.clear()


def _jwks_client(url: str) -> pyjwt.PyJWKClient:
    client = _clients.get(url)
    if client is None:
        client = pyjwt.PyJWKClient(url, cache_keys=True, lifespan=_KEY_CACHE_SECONDS)
        _clients[url] = client
    return client


def _unverified_issuer(token: str) -> str | None:
    try:
        iss = pyjwt.decode(token, options={"verify_signature": False}).get("iss")
    except pyjwt.PyJWTError:
        return None
    return iss if isinstance(iss, str) else None


def try_decode_service_token(token: str) -> AuthContext | None:
    """Arbor's service context for a valid Vercel token; None if not one.

    None means "not a token for this path" (not configured, or another
    issuer), so the caller may try its other verifiers. A token that names the
    Vercel issuer but fails any check raises ValueError("invalid_token").
    """
    unverified_iss = _unverified_issuer(token)
    if unverified_iss is None or not unverified_iss.startswith("https://oidc.vercel.com"):
        return None

    settings = _settings()
    if settings is None or unverified_iss != settings.issuer:
        _log.warning("service_oidc_refused: issuer %s is not configured", unverified_iss)
        raise ValueError("invalid_token")

    try:
        signing_key = _jwks_client(settings.jwks_url).get_signing_key_from_jwt(token)
        claims = pyjwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.audience,
            issuer=settings.issuer,
            leeway=_LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "nbf", "iss", "aud", "sub"]},
        )
    except pyjwt.PyJWTError as exc:
        _log.warning("service_oidc_refused: %s", exc)
        raise ValueError("invalid_token") from exc

    for claim, allowed in (
        ("owner_id", {settings.owner_id}),
        ("project_id", {settings.project_id}),
        ("environment", settings.environments),
    ):
        if claims.get(claim) not in allowed:
            _log.warning("service_oidc_refused: %s=%r", claim, claims.get(claim))
            raise ValueError("invalid_token")

    return AuthContext(
        sub=SERVICE_SUBJECT,
        tenant_id=SERVICE_TENANT,
        scopes=list(SERVICE_SCOPES),
        roles=[],
        jti=None,
        exp=int(claims["exp"]),
    )
