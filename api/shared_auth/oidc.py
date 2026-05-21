"""
OIDC token validation via JWKS.

Activated only when OIDC_JWKS_URL environment variable is set.
Supports any standards-compliant IdP: Microsoft Entra, Okta, Auth0, Google Workspace, etc.

Environment variables:
    OIDC_JWKS_URL      Required. JWKS endpoint (e.g. https://login.microsoftonline.com/{tid}/discovery/v2.0/keys)
    OIDC_ISSUER        Required when OIDC_JWKS_URL set. Expected `iss` claim value.
    OIDC_AUDIENCE      Required when OIDC_JWKS_URL set. Expected `aud` claim value.
    OIDC_ROLES_CLAIM   Optional. JWT claim carrying role list (default: "roles").
    OIDC_TENANT_CLAIM  Optional. JWT claim carrying tenant/org ID (default: "tid").
"""
from __future__ import annotations

import logging
import os

_logger = logging.getLogger("shared_auth.oidc")

_JWKS_URL = os.getenv("OIDC_JWKS_URL", "").strip()
_OIDC_ISSUER = os.getenv("OIDC_ISSUER", "").strip()
_OIDC_AUDIENCE = os.getenv("OIDC_AUDIENCE", "").strip()
_OIDC_ROLES_CLAIM = os.getenv("OIDC_ROLES_CLAIM", "roles")
_OIDC_TENANT_CLAIM = os.getenv("OIDC_TENANT_CLAIM", "tid")

_jwks_client = None  # lazy singleton


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is None:
        from jwt import PyJWKClient
        _jwks_client = PyJWKClient(_JWKS_URL, cache_keys=True, lifespan=300)
    return _jwks_client


def try_decode_oidc_token(token: str):
    """
    Attempt to validate token as an OIDC token from the configured IdP.

    Returns AuthContext if valid, None if OIDC is not configured.
    Raises ValueError("invalid_token") if OIDC is configured but the token is invalid.
    """
    if not _JWKS_URL:
        return None  # OIDC not configured — caller should try internal JWT

    import jwt as pyjwt
    from shared_auth.models import AuthContext

    try:
        client = _get_jwks_client()
        signing_key = client.get_signing_key_from_jwt(token)

        decode_kwargs: dict = {
            "algorithms": ["RS256", "ES256", "RS384", "ES384"],
        }
        if _OIDC_AUDIENCE:
            decode_kwargs["audience"] = _OIDC_AUDIENCE
        if _OIDC_ISSUER:
            decode_kwargs["issuer"] = _OIDC_ISSUER

        payload = pyjwt.decode(token, signing_key.key, **decode_kwargs)

    except Exception as exc:
        _logger.debug("oidc_token_invalid: %s", exc)
        raise ValueError("invalid_token") from exc

    sub = payload.get("sub") or payload.get("oid") or ""
    if not sub:
        raise ValueError("invalid_token")

    # Tenant: try OIDC_TENANT_CLAIM first, then fall back to tenant_id claim
    tenant_id = (
        payload.get(_OIDC_TENANT_CLAIM)
        or payload.get("tenant_id")
        or payload.get("tid")
        or ""
    )

    roles_raw = payload.get(_OIDC_ROLES_CLAIM) or []
    roles = [r for r in roles_raw if isinstance(r, str)]

    scopes_raw = payload.get("scp") or payload.get("scope") or payload.get("scopes") or []
    if isinstance(scopes_raw, str):
        scopes_raw = scopes_raw.split()
    scopes = [s for s in scopes_raw if isinstance(s, str)]

    exp = payload.get("exp", 0)

    return AuthContext(
        sub=str(sub),
        tenant_id=str(tenant_id),
        scopes=scopes,
        roles=roles,
        jti=payload.get("jti"),
        exp=int(exp),
    )
