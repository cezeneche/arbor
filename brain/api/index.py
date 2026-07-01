"""Vercel Python entrypoint. Exposes the FastAPI ASGI app as `app`.

Vercel's Python runtime serves the module-level `app`; `vercel.json` rewrites
every path here. Kept as a thin shim so the application lives in app/.
"""
import os
import sys

# Ensure the project root (brain/) is importable when Vercel invokes this file.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app  # noqa: E402

__all__ = ["app"]
