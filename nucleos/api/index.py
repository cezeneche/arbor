"""Vercel Python entrypoint. Exposes the FastAPI ASGI app as `app`.

Mirrors brain/api/index.py, with one difference forced by layout: brain keeps its
packages in brain/app/, so brain/api/ holds only this shim. Nucleos's packages
live inside api/ (app/, ledger_app/, shared_auth/), and Vercel's Python runtime
turns every .py under api/ into its own function by default — which would build
several hundred meaningless endpoints out of the service's own modules.

vercel.json therefore names this file as the only build target explicitly, rather
than letting the runtime discover functions. That is why this deployment declares
`builds` instead of relying on convention.
"""
import os
import sys

# api/ is the import root: modules refer to `app.*`, `ledger_app.*` and
# `shared_auth.*` as top-level packages, exactly as pytest.ini's pythonpath does.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import app  # noqa: E402

__all__ = ["app"]
