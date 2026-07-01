"""Internal service authentication for the brain.

The brain sits behind the TypeScript app on a private contract, not the public
internet. Every non-health request must carry the shared secret in the
`X-Brain-Token` header, compared in constant time to BRAIN_INTERNAL_TOKEN.

Fail closed: if the secret is not configured, the brain refuses protected
requests (503) rather than serving them unauthenticated. Compared with
`hmac.compare_digest` to avoid leaking the secret through timing.
"""
from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import Header, HTTPException, status

TOKEN_HEADER = "X-Brain-Token"


def require_internal_token(x_brain_token: Optional[str] = Header(default=None)) -> None:
    expected = os.environ.get("BRAIN_INTERNAL_TOKEN")
    if not expected:
        # Misconfiguration must not silently drop the auth boundary.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="brain internal token not configured",
        )
    if not x_brain_token or not hmac.compare_digest(x_brain_token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing internal token",
        )
