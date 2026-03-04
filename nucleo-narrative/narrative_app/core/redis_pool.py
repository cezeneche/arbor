"""
Shared Redis async connection pool for job queue + idempotency.
Returns None when REDIS_URL is not configured — all callers must handle the None case.
"""
from __future__ import annotations

import os

REDIS_URL = os.getenv("REDIS_URL", "").strip()

_pool = None


def get_redis_pool():
    """Return a redis.asyncio pool, or None if Redis is not configured."""
    global _pool
    if not REDIS_URL:
        return None
    if _pool is None:
        import redis.asyncio as aioredis  # type: ignore[import]
        _pool = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _pool
