"""
Rate-limit key helpers — slowapi dependency removed.

user_or_ip_key is no longer used for @limiter.limit() decorators (all removed),
but the function is retained here so any remaining imports resolve without error.
"""
from __future__ import annotations

from fastapi import Request


def user_or_ip_key(request: Request) -> str:
    """Return JWT sub when authenticated; fall back to client IP."""
    auth = getattr(request.state, "auth_context", None)
    if auth is not None:
        sub = getattr(auth, "sub", None)
        if sub:
            return f"sub:{sub}"
    client = request.client
    return client.host if client else "unknown"
