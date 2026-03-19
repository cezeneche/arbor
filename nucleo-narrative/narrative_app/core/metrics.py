"""
Metrics stubs — Prometheus dependency removed.

These no-op objects replace the former prometheus_client Gauge/Counter/Histogram
so any remaining legacy imports resolve without error. They do nothing.
"""
from __future__ import annotations


class _Noop:
    """No-op stub for any prometheus_client metric type."""

    def labels(self, *args, **kwargs) -> "_Noop":
        return self

    def inc(self, amount: float = 1) -> None:
        pass

    def dec(self, amount: float = 1) -> None:
        pass

    def observe(self, amount: float) -> None:
        pass

    def set(self, value: float) -> None:
        pass

    def __call__(self, *args, **kwargs) -> "_Noop":
        return self


llm_duration = _Noop()
llm_errors = _Noop()
llm_retries = _Noop()
pipeline_active = _Noop()
job_queue_depth = _Noop()
