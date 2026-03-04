"""
Per-user rate limit key: JWT sub when authenticated, IP address as fallback.
Import user_or_ip_key and use it as the slowapi key_func.
"""
from __future__ import annotations

from fastapi import Request
from slowapi.util import get_remote_address


def user_or_ip_key(request: Request) -> str:
    """Use JWT sub as rate limit key when authenticated; fall back to IP."""
    auth = getattr(request.state, "auth_context", None)
    if auth is not None:
        sub = getattr(auth, "sub", None)
        if sub:
            return f"sub:{sub}"
    return get_remote_address(request)
