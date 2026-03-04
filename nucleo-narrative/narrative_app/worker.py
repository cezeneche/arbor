"""
ARQ worker entry point.
Run with:   arq narrative_app.worker.WorkerSettings
"""
from narrative_app.jobs.pipeline_job import WorkerSettings  # noqa: F401
