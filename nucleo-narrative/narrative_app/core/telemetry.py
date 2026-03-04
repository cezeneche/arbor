"""
OpenTelemetry distributed tracing setup for nucleo-narrative.
No-op when OTLP_ENDPOINT env var is absent — safe for all environments.
"""
from __future__ import annotations

import os


def setup_telemetry(app) -> None:  # app: FastAPI
    otlp_endpoint = os.getenv("OTLP_ENDPOINT", "").strip()
    if not otlp_endpoint:
        return  # tracing disabled — no-op

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    except ImportError:
        import logging
        logging.getLogger("narrative.telemetry").warning(
            "OTLP_ENDPOINT set but opentelemetry packages not installed; tracing disabled."
        )
        return

    provider = TracerProvider(
        resource=Resource({"service.name": "nucleo-narrative"})
    )
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=otlp_endpoint))
    )
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app)
    HTTPXClientInstrumentor().instrument()
