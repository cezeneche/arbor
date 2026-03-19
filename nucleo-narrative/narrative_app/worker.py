"""
ARQ worker entry point — stub (async job queue removed).

All pipeline execution is now synchronous within the HTTP request cycle.
"""
from narrative_app.jobs.pipeline_job import WorkerSettings  # noqa: F401
