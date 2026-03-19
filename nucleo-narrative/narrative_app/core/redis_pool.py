"""
Redis pool stub — Redis dependency removed.

Returns None for all calls so any remaining legacy imports resolve without error.
REDIS_URL is kept as an empty string constant so callers that check it continue to
get a falsy value and skip Redis-dependent code paths.
"""
from __future__ import annotations

REDIS_URL = ""


def get_redis_pool():
    """Always returns None — Redis is not configured."""
    return None
