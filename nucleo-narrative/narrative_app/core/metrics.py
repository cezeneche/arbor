"""
Custom Prometheus metrics for the nucleo-narrative LLM pipeline.
Import these singletons anywhere in the service; prometheus_client handles registration.
"""
from prometheus_client import Counter, Gauge, Histogram

llm_duration = Histogram(
    "llm_call_duration_seconds",
    "LLM call wall-clock duration",
    labelnames=["provider", "stage"],
)

llm_errors = Counter(
    "llm_call_errors_total",
    "LLM call errors",
    labelnames=["provider", "stage", "error_type"],
)

llm_retries = Counter(
    "llm_call_retries_total",
    "LLM call retry attempts",
    labelnames=["provider", "stage"],
)

pipeline_active = Gauge(
    "narrative_pipeline_active",
    "Number of pipeline requests currently executing",
)

job_queue_depth = Gauge(
    "narrative_job_queue_depth",
    "Approximate ARQ job queue depth",
)
