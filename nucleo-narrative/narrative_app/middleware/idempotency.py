"""
Idempotency middleware — passthrough (Redis dependency removed).

The middleware class is retained so existing main.py imports don't break,
but it no longer does anything. All requests pass straight through.
"""
from __future__ import annotations

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware


class IdempotencyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        return await call_next(request)
