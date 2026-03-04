"""
Idempotency middleware for nucleo-ledger.
When X-Idempotency-Key header is present on a POST request:
  - Hit: return cached response (same status code + body)
  - Miss: execute request, cache response for 24 h

Only active when REDIS_URL env var is set. No-op otherwise.
"""
from __future__ import annotations

import json
import os

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware

_REDIS_URL = os.getenv("REDIS_URL", "").strip()
_TTL = 86400  # 24 hours


def _get_redis():
    if not _REDIS_URL:
        return None
    try:
        import redis.asyncio as aioredis  # type: ignore[import]
        return aioredis.from_url(_REDIS_URL, decode_responses=True)
    except Exception:
        return None


_redis = _get_redis()


class IdempotencyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        key = request.headers.get("X-Idempotency-Key")
        if not key or request.method != "POST" or _redis is None:
            return await call_next(request)

        cache_key = f"idem:ledger:{key}"
        try:
            cached = await _redis.get(cache_key)
        except Exception:
            return await call_next(request)

        if cached:
            try:
                payload = json.loads(cached)
                return JSONResponse(
                    status_code=payload["status"],
                    content=payload["body"],
                )
            except Exception:
                pass

        response = await call_next(request)
        body = b""
        async for chunk in response.body_iterator:
            body += chunk

        try:
            body_json = json.loads(body)
            await _redis.setex(
                cache_key,
                _TTL,
                json.dumps({"status": response.status_code, "body": body_json}),
            )
        except Exception:
            pass

        return Response(
            content=body,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.media_type,
        )
