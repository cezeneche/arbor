"""
ARQ worker stub — async job queue removed.

All pipeline execution is now synchronous within the HTTP request cycle.
This file is retained so any external references to WorkerSettings don't
cause import errors; it defines an empty worker with no functions.
"""
from __future__ import annotations

import asyncio
import os


class WorkerSettings:
    """Empty ARQ worker — no functions registered (queue removed)."""
    redis_settings = None
    functions: list = []
    max_jobs = 0
