import json
import os
import time

from narrative_app.core.config import settings
from narrative_app.core.circuit_breaker import CircuitOpenError, _openai_breaker
from narrative_app.core.metrics import llm_duration, llm_errors, llm_retries


def _legacy_writer_prompt(packet: dict) -> str:
    return (
        "You are generating an audit-grade carbon emissions narrative.\n"
        "Return ONLY valid JSON. Do not include markdown, explanations, or commentary.\n"
        "Use ONLY the provided JSON packet. Do not invent numbers, documents, dates, or sources.\n"
        "If data is missing or low confidence, state this clearly in the appropriate fields.\n\n"
        "The JSON MUST follow this exact schema:\n"
        "{\n"
        '  "executive_summary": "string",\n'
        '  "methodology": "string",\n'
        '  "results": {\n'
        '    "total_emissions_kgco2e": number,\n'
        '    "scope_1_kgco2e": number,\n'
        '    "scope_2_kgco2e": number,\n'
        '    "intensity_kgco2e_per_unit": number\n'
        '  },\n'
        '  "limitations": "string",\n'
        '  "open_gaps": [\n'
        '    {\n'
        '      "field": "string",\n'
        '      "issue": "string",\n'
        '      "current_confidence": number,\n'
        '      "target_confidence": number\n'
        '    }\n'
        '  ]\n'
        "}\n\n"
        "JSON packet:\n"
        + json.dumps(packet, indent=2)
    )


def _cbam_writer_prompt(packet: dict) -> str:
    return (
        "You are generating an audit-grade CBAM quarterly narrative.\n"
        "Return ONLY valid JSON. Do not include markdown, explanations, or commentary.\n"
        "Use ONLY the provided JSON packet. Do not invent numbers, documents, dates, or sources.\n"
        "Do NOT invent electricity or natural gas content for CBAM packets.\n"
        "Use these packet sections directly:\n"
        "- case: importer_eori, reporting_year, reporting_quarter\n"
        "- shipments[].goods_lines[].goods_line: cn_code, quantity or net_mass\n"
        "- shipments[].goods_lines[].latest_emissions: direct_embedded_kgco2e, indirect_embedded_kgco2e, method, version\n"
        "- summary totals\n"
        "- data_quality.warnings\n"
        "open_gaps must be derived from: missing emissions warnings, missing/empty shipments/goods_lines, and data_quality warnings.\n\n"
        "The JSON MUST follow this exact schema:\n"
        "{\n"
        '  "executive_summary": "string",\n'
        '  "methodology": "string",\n'
        '  "results": {\n'
        '    "total_direct_embedded_kgco2e": number,\n'
        '    "total_indirect_embedded_kgco2e": number,\n'
        '    "total_embedded_kgco2e": number,\n'
        '    "total_net_mass_kg": number,\n'
        '    "goods_lines_count": number\n'
        '  },\n'
        '  "limitations": "string",\n'
        '  "open_gaps": [\n'
        '    {\n'
        '      "field": "string",\n'
        '      "issue": "string",\n'
        '      "current_confidence": number,\n'
        '      "target_confidence": number\n'
        '    }\n'
        '  ]\n'
        "}\n\n"
        "JSON packet:\n"
        + json.dumps(packet, indent=2)
    )


def _writer_prompt(packet: dict) -> str:
    if packet.get("type") == "cbam_report_package_v1":
        return _cbam_writer_prompt(packet)
    return _legacy_writer_prompt(packet)


def _call_openai(packet: dict) -> dict:
    """Single attempt — wrapped by retry + circuit breaker in generate_draft."""
    from openai import OpenAI

    timeout = float(os.getenv("LLM_TIMEOUT_SECONDS", "30"))
    client = OpenAI(api_key=settings.openai_api_key, timeout=timeout)

    resp = client.responses.create(
        model=settings.openai_model,
        input=_writer_prompt(packet),
        temperature=0.2,
        text={"format": {"type": "json_object"}},
    )

    raw = resp.output_text or ""

    try:
        parsed = json.loads(raw)
    except Exception as e:
        raise ValueError(f"OpenAI draft did not return valid JSON: {e}")

    required_keys = [
        "executive_summary",
        "methodology",
        "results",
        "limitations",
        "open_gaps",
    ]

    for key in required_keys:
        if key not in parsed:
            raise ValueError(f"OpenAI draft missing required key: {key}")

    return parsed


def generate_draft(packet: dict) -> dict:
    _stage = "draft"
    _provider = "openai"
    _attempts = int(os.getenv("LLM_RETRY_ATTEMPTS", "3"))

    # OTel span (no-op when tracing not configured)
    try:
        from opentelemetry import trace as _otel_trace
        _tracer = _otel_trace.get_tracer("nucleo-narrative")
        _span_ctx = _tracer.start_as_current_span("openai.generate_draft")
    except Exception:
        from contextlib import nullcontext
        _span_ctx = nullcontext()

    with _span_ctx:
        last_exc: Exception | None = None
        for attempt in range(1, _attempts + 1):
            if attempt > 1:
                llm_retries.labels(provider=_provider, stage=_stage).inc()
                import time as _time
                _time.sleep(min(2 ** (attempt - 2), 10))

            t0 = time.monotonic()
            try:
                result = _openai_breaker.call(_call_openai, packet)
                llm_duration.labels(provider=_provider, stage=_stage).observe(
                    time.monotonic() - t0
                )
                return result
            except CircuitOpenError as e:
                llm_errors.labels(
                    provider=_provider, stage=_stage, error_type="circuit_open"
                ).inc()
                raise
            except Exception as exc:
                llm_duration.labels(provider=_provider, stage=_stage).observe(
                    time.monotonic() - t0
                )
                error_type = type(exc).__name__
                llm_errors.labels(
                    provider=_provider, stage=_stage, error_type=error_type
                ).inc()
                last_exc = exc

        raise last_exc  # type: ignore[misc]
