from __future__ import annotations

import os
import json
import base64
import hmac
import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

try:
    import jwt as pyjwt
    from jwt import InvalidTokenError
except ImportError:  # pragma: no cover
    pyjwt = None
    InvalidTokenError = Exception

from shared_auth.models import AuthContext


@dataclass(frozen=True)
class JWTSettings:
    secret: str
    issuer: str
    audience: str
    expires_seconds: int


def _get_bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def get_jwt_settings() -> JWTSettings:
    secret = (os.getenv("JWT_SECRET") or "dev-jwt-secret-change-me").strip()
    issuer = (os.getenv("JWT_ISSUER") or "scope3-agentic").strip()
    audience = (os.getenv("JWT_AUDIENCE") or "scope3-clients").strip()

    try:
        expires_seconds = int(os.getenv("JWT_EXPIRES_SECONDS", "3600"))
    except ValueError:
        expires_seconds = 3600

    return JWTSettings(
        secret=secret,
        issuer=issuer,
        audience=audience,
        expires_seconds=max(1, expires_seconds),
    )


def is_dev_token_endpoint_enabled() -> bool:
    return _get_bool_env("AUTH_DEV_TOKEN_ENDPOINT", default=False)


def create_access_token(
    *,
    sub: str,
    tenant_id: str,
    org_id: str | None = None,
    scopes: list[str] | None = None,
    expires_seconds: int | None = None,
) -> tuple[str, int]:
    settings = get_jwt_settings()
    ttl = expires_seconds if expires_seconds is not None else settings.expires_seconds
    ttl = max(1, int(ttl))

    now = datetime.now(timezone.utc)
    exp = now + timedelta(seconds=ttl)

    payload = {
        "sub": sub,
        "tenant_id": tenant_id,
        "org_id": org_id if org_id is not None else tenant_id,
        "scopes": list(scopes or []),
        "jti": str(uuid4()),
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "iss": settings.issuer,
        "aud": settings.audience,
    }
    if pyjwt is not None:
        token = pyjwt.encode(payload, settings.secret, algorithm="HS256")
    else:
        token = _encode_hs256(payload, settings.secret)
    return token, ttl


def decode_access_token(token: str) -> AuthContext:
    settings = get_jwt_settings()

    if pyjwt is not None:
        try:
            payload = pyjwt.decode(
                token,
                settings.secret,
                algorithms=["HS256"],
                audience=settings.audience,
                issuer=settings.issuer,
            )
        except InvalidTokenError as exc:
            raise ValueError("invalid_token") from exc
    else:
        payload = _decode_hs256(
            token=token,
            secret=settings.secret,
            audience=settings.audience,
            issuer=settings.issuer,
        )

    sub = payload.get("sub")
    tenant_id = payload.get("tenant_id")
    exp = payload.get("exp")

    if not isinstance(sub, str) or not sub.strip():
        raise ValueError("invalid_token")
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        raise ValueError("invalid_token")
    if not isinstance(exp, int):
        raise ValueError("invalid_token")

    scopes = payload.get("scopes") or []
    if not isinstance(scopes, list) or any(not isinstance(s, str) for s in scopes):
        scopes = []

    jti = payload.get("jti")
    if not isinstance(jti, str):
        jti = None

    return AuthContext(
        sub=sub,
        tenant_id=tenant_id,
        scopes=scopes,
        jti=jti,
        exp=exp,
    )


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _encode_hs256(payload: dict, secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    encoded_header = _b64url_encode(json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    encoded_payload = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{encoded_header}.{encoded_payload}.{_b64url_encode(signature)}"


def _decode_hs256(*, token: str, secret: str, audience: str, issuer: str) -> dict:
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
    except ValueError as exc:
        raise ValueError("invalid_token") from exc

    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    expected_signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    provided_signature = _b64url_decode(signature_b64)
    if not hmac.compare_digest(expected_signature, provided_signature):
        raise ValueError("invalid_token")

    try:
        header = json.loads(_b64url_decode(header_b64))
        payload = json.loads(_b64url_decode(payload_b64))
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError("invalid_token") from exc

    if header.get("alg") != "HS256":
        raise ValueError("invalid_token")
    if payload.get("aud") != audience or payload.get("iss") != issuer:
        raise ValueError("invalid_token")

    exp = payload.get("exp")
    if not isinstance(exp, int):
        raise ValueError("invalid_token")
    if int(datetime.now(timezone.utc).timestamp()) >= exp:
        raise ValueError("invalid_token")

    return payload
