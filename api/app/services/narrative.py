"""
Consolidated narrative pipeline service — single Claude call.

Architecture change (replaces 3-stage OpenAI → Claude → Gemini pipeline):
  - One Claude call generates the full narrative (executive_summary, methodology,
    limitations, open_gaps) from the report package in a single deterministic pass.
  - After Claude responds, results{} is HARD OVERRIDDEN with values extracted
    directly from the report_package. Claude cannot alter calculation outputs.
  - No circuit breaker library — Claude unavailability returns an error response.
  - No OpenAI or Google Generative AI SDK dependencies.

Report-package data is fetched via direct in-process function call to the ledger
report package builder (no inter-service HTTP, no JWT generation).
"""
from __future__ import annotations

import json
import logging
import os
import time
from uuid import UUID

from fastapi import BackgroundTasks, HTTPException, Request

log = logging.getLogger("nucleos.narrative")

_REQUIRED_NARRATIVE_KEYS = (
    "executive_summary",
    "methodology",
    "limitations",
    "open_gaps",
    "results",
)


# ── Report-package fetching ────────────────────────────────────────────────────

def fetch_report_packet(case_id: str, packet_kind: str, request: Request) -> dict:
    """
    Fetch the structured report packet for the narrative pipeline.

    Replaces nucleo-narrative's HTTP call to:
      GET /api/cbam/cases/{id}/report-package   (packet_kind="cbam")
      GET /api/cases/{id}/report-package         (packet_kind="legacy")

    Both routes resolve to get_cbam_report_package() internally, so we call
    it directly. The request object carries tenant_id and request_id for
    audit continuity — the report package builder reads these from request.state.

    Must pass export_format="json" explicitly: when calling a FastAPI route
    function directly (not via HTTP), Query(...) defaults are not resolved by
    FastAPI's DI system — they remain as FieldInfo objects.
    """
    try:
        case_uuid = UUID(case_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=404, detail=f"Invalid case_id UUID: {case_id!r}"
        ) from exc

    from ledger_app.api.cbam.report import get_cbam_report_package

    result = get_cbam_report_package(request, case_uuid, export_format="json")

    # The route always wraps its output in a fastapi.responses.Response for
    # consistent HTTP serialization (including for export_format="json").
    # When calling the function directly (not via HTTP), we must parse the body.
    if hasattr(result, "body"):
        import json as _json
        body = result.body
        result = _json.loads(body if isinstance(body, str) else body.decode("utf-8"))

    if not isinstance(result, dict):
        raise HTTPException(
            status_code=500,
            detail=f"Report package builder returned unexpected type: {type(result).__name__}",
        )
    return result


# ── Authoritative results extraction (hard override) ──────────────────────────

def _extract_results_from_packet(packet: dict) -> dict:
    """
    Extract the authoritative numeric results from the report package.

    This dict replaces whatever Claude put in results{} — Claude cannot
    alter calculation outputs even if it attempts to. Values come directly
    from the ledger's summary block (CBAM) or results block (legacy).

    CBAM packet fields map to EU 2023/1773 Art. 3 calculation outputs.
    Legacy packet fields map to scope-1/scope-2 totals.
    """
    if packet.get("type") == "cbam_report_package_v1":
        summary = packet.get("summary") or {}
        # CPR figures come from the HMRC return block when present; fall back to
        # summary so the narrative always reflects the authoritative financial totals.
        hmrc = packet.get("hmrc_return") or {}
        return {
            "total_direct_embedded_kgco2e": summary.get("total_direct_emissions_kgco2e"),
            "total_indirect_embedded_kgco2e": summary.get("total_indirect_emissions_kgco2e"),
            "total_embedded_kgco2e": summary.get("total_embedded_emissions_kgco2e"),
            "total_net_mass_kg": summary.get("total_net_mass_kg"),
            "goods_lines_count": summary.get("total_goods_lines"),
            # HMRC financial totals — Claude must NEVER compute these; values come
            # directly from the report package (CLAUDE.md Rule 6).
            "total_cbam_charge_gbp": hmrc.get("total_cbam_charge_gbp")
                or summary.get("total_cbam_charge_gbp"),
            "total_cpr_gbp": hmrc.get("total_cpr_gbp")
                or summary.get("total_cpr_gbp"),
            "total_cbam_liability_gbp": hmrc.get("total_cbam_liability_gbp")
                or summary.get("total_cbam_liability_gbp"),
        }

    # Legacy report package
    results = packet.get("results") or {}
    return {
        "total_emissions_kgco2e": results.get("total_kgco2e"),
        "scope_1_kgco2e": results.get("scope_1_natural_gas_kgco2e"),
        "scope_2_kgco2e": results.get("scope_2_electricity_kgco2e"),
        "intensity_kgco2e_per_unit": results.get("kgco2e_per_unit"),
    }


# ── Claude prompt ──────────────────────────────────────────────────────────────

def _build_prompt(packet: dict) -> str:
    is_cbam = packet.get("type") == "cbam_report_package_v1"

    if is_cbam:
        results_schema = (
            '  "results": {}\n'
            "  // Leave results as an empty object — it will be populated\n"
            "  // with authoritative values from the report package after your response.\n"
        )
        packet_guidance = (
            "Key packet sections to use:\n"
            "  case: importer_eori, reporting_year, reporting_quarter\n"
            "  shipments[].goods_lines[].goods_line: cn_code, quantity, net_mass\n"
            "  shipments[].goods_lines[].latest_emissions: direct_embedded_kgco2e,\n"
            "    indirect_embedded_kgco2e, method, version\n"
            "  summary: total embedded emissions totals (state these values verbatim,\n"
            "    do not recompute)\n"
            "  data_quality.warnings: source for limitations and open_gaps\n"
            "  data_quality.repair_log[].repair_failed items: state each failure\n"
            "    verbatim in limitations using the invoice/document reference\n"
        )
    else:
        results_schema = (
            '  "results": {}\n'
            "  // Leave results as an empty object — it will be populated\n"
            "  // with authoritative values from the report package after your response.\n"
        )
        packet_guidance = (
            "Key packet sections to use:\n"
            "  results: total_kgco2e, scope_1_natural_gas_kgco2e,\n"
            "    scope_2_electricity_kgco2e, kgco2e_per_unit (state verbatim)\n"
            "  data_quality.warnings: source for limitations and open_gaps\n"
            "  data_quality.repair_log[].repair_failed items: state each failure\n"
            "    verbatim in limitations\n"
        )

    return (
        "You are generating an audit-grade CBAM compliance narrative.\n"
        "Return ONLY valid JSON — no markdown fencing, no commentary, no text outside the JSON object.\n\n"
        "CRITICAL RULES:\n"
        "1. Do NOT invent, compute, or modify any numeric values, identifiers, dates, or CN codes.\n"
        "2. The 'results' key will be REPLACED after your response with authoritative\n"
        "   values from the report package. Return results as an empty object {}.\n"
        "3. All prose must be grounded in the packet provided. Do not extrapolate.\n"
        "4. Temperature is 0.0 — be factual and deterministic.\n\n"
        + packet_guidance
        + "\n"
        "OUTPUT SCHEMA (return exactly this structure, no extra keys):\n"
        "{\n"
        '  "executive_summary": "Plain English summary: what was calculated, which\n'
        "    emission method was applied (actual/estimated/default), and the total\n"
        "    embedded emissions figure (quote the value from the packet — do not compute).\n"
        '    Include importer EORI, reporting period, and number of shipments.",\n'
        '  "methodology": "Which tier (actual/estimated/default) was applied per sector\n'
        "    and per goods line. State the regulatory basis: EU 2023/1773 Art. 4 for\n"
        "    default values, Art. 3 for actual measurement. Name the emission factors\n"
        '    and versions used as cited in the packet.",\n'
        '  "limitations": "Human-readable description of all repair_failed and\n'
        "    plausibility_warning items. For each item, state: which field could not\n"
        "    be extracted, which document it came from, and the recovery method used\n"
        "    (e.g. pattern matching) with the confidence score if available.\n"
        "    Example: 'Origin country could not be extracted from invoice INV-2027-001\n"
        '    and was recovered by pattern matching with confidence 0.82\'.",\n'
        '  "open_gaps": [\n'
        "    {\n"
        '      "field": "field name that is missing or low-confidence",\n'
        '      "issue": "Plain English description of what is missing and what the\n'
        '        importer needs to provide to resolve this gap.",\n'
        '      "current_confidence": <number from packet, or 0 if absent>,\n'
        '      "target_confidence": 1.0\n'
        "    }\n"
        "  ],\n"
        + results_schema
        + "}\n\n"
        "REPORT PACKAGE JSON:\n"
        + json.dumps(packet, indent=2, default=str)
    )


# ── Claude API call ────────────────────────────────────────────────────────────

def _call_claude(packet: dict) -> dict:
    """
    Single Claude call that generates the full narrative in one pass.

    Returns the parsed narrative dict. Raises on any failure — the caller
    wraps this in try/except and returns an error response (no circuit breaker).
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set — narrative pipeline cannot run"
        )

    try:
        import anthropic
    except ImportError as exc:
        raise RuntimeError("anthropic SDK is not installed") from exc

    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    timeout = float(os.getenv("LLM_TIMEOUT_SECONDS", "60"))

    client = anthropic.Anthropic(api_key=api_key)

    t0 = time.monotonic()
    try:
        resp = client.messages.create(
            model=model,
            max_tokens=4096,
            temperature=0.0,
            timeout=timeout,
            messages=[
                {
                    "role": "user",
                    "content": _build_prompt(packet),
                }
            ],
        )
    finally:
        log.info(
            "claude.narrative elapsed=%.2fs model=%s",
            time.monotonic() - t0,
            model,
        )

    # Extract text from response blocks
    blocks = getattr(resp, "content", None) or []
    text = "\n".join(
        getattr(b, "text", "") for b in blocks if getattr(b, "text", None)
    ).strip()

    if not text:
        raise RuntimeError("Claude returned an empty response")

    # Strip accidental markdown fencing (defensive — prompt forbids it)
    if text.startswith("```"):
        lines = text.splitlines()
        lines = lines[1:]  # drop opening fence
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        narrative = json.loads(text)
    except json.JSONDecodeError as exc:
        snippet = text[:500]
        raise RuntimeError(
            f"Claude did not return valid JSON: {exc}. Snippet: {snippet!r}"
        ) from exc

    if not isinstance(narrative, dict):
        raise RuntimeError(
            f"Claude returned JSON but not an object (got {type(narrative).__name__})"
        )

    # Validate required keys are present
    missing = [k for k in _REQUIRED_NARRATIVE_KEYS if k not in narrative]
    if missing:
        raise RuntimeError(f"Claude response missing required keys: {missing}")

    if not isinstance(narrative.get("open_gaps"), list):
        raise RuntimeError("Claude response: 'open_gaps' must be a list")

    return narrative


# ── Review flag persistence ────────────────────────────────────────────────────

def _persist_review_flag(
    case_id: str,
    human_review_required: bool,
    tenant_id: str,
) -> None:
    """
    Best-effort: update review_status on the case after pipeline completes.

    Calls the review service functions directly (same process, no HTTP).
    Never raises — pipeline result is returned regardless of flag persistence.
    """
    from ledger_app.api.review import clear_review_flag, flag_for_review
    from shared_auth.models import AuthContext

    service_ctx = AuthContext(
        sub="narrative-service",
        tenant_id=tenant_id,
        scopes=["cbam:write"],
        jti="internal",
        exp=9_999_999_999,
    )
    try:
        if human_review_required:
            flag_for_review(case_id, auth_context=service_ctx)
        else:
            clear_review_flag(case_id, auth_context=service_ctx)
    except Exception as exc:
        log.debug("review flag update failed (non-fatal): %s", exc)


# ── Pipeline entry point ───────────────────────────────────────────────────────

def _schedule_review_notification(
    case_id: str,
    packet: dict,
    flags: list[str],
    background_tasks: BackgroundTasks,
) -> None:
    """Best-effort: register the Slack review-required notification as a background task.

    Tenant name is read directly from the already-fetched packet — no extra DB call.
    All failures are logged at DEBUG and swallowed so they never affect the pipeline.
    """
    try:
        from app.services.notifications import notify_review_required

        case_data   = packet.get("case") or {}
        tenant_name = case_data.get("importer_name") or "Unknown Tenant"
        eori        = case_data.get("importer_eori") or ""
        year        = case_data.get("reporting_year")
        quarter     = case_data.get("reporting_quarter")
        period      = (f"Q{quarter} {year}" if quarter else str(year)) if year else ""
        sector      = case_data.get("sector") or ""
        shipments   = packet.get("shipments") or []
        goods_lines = sum(len(s.get("goods", [])) for s in shipments) or None
        base_url    = os.getenv("BASE_URL", "")
        background_tasks.add_task(
            notify_review_required,
            case_id=case_id,
            tenant_name=tenant_name,
            flags=flags,
            base_url=base_url,
            eori=eori,
            period=period,
            sector=sector,
            goods_lines_count=goods_lines,
        )
    except Exception as exc:
        log.debug("_schedule_review_notification: skipped (non-fatal): %s", exc)


def run_pipeline_stages(
    *,
    case_id: str,
    packet_kind: str = "legacy",
    request: Request,
    background_tasks: BackgroundTasks | None = None,
) -> dict:
    """
    Execute the narrative pipeline: one Claude call, results hard-overridden.

    Steps:
      1. Fetch report package (direct in-process call, no HTTP)
      2. Block if data_quality.blocking is true
      3. Call Claude once to generate prose narrative
      4. Hard override results{} with values from the report package
      5. Persist review flag to ledger (best-effort)

    Used by both the sync endpoint (/api/cases/{id}/narrative/pipeline) and
    the ARQ background job. Returns a result dict in all cases — never raises.
    """
    # Step 1 — fetch packet
    try:
        packet = fetch_report_packet(case_id, packet_kind, request)
    except HTTPException:
        raise  # propagate 404/500 to the router
    except Exception as exc:
        return {
            "case_id": case_id,
            "final_narrative_json": None,
            "human_review_required": True,
            "stage_errors": [{"stage": "fetch_packet", "error": str(exc)}],
        }

    # Step 2 — data quality gate
    data_quality = packet.get("data_quality") or {}
    if bool(data_quality.get("blocking")):
        return {
            "case_id": case_id,
            "blocked": True,
            "data_quality": data_quality,
        }

    # Step 3 — single Claude call
    try:
        narrative = _call_claude(packet)
    except Exception as exc:
        log.error("Claude narrative call failed for case %s: %s", case_id, exc)
        return {
            "case_id": case_id,
            "final_narrative_json": None,
            "human_review_required": True,
            "stage_errors": [{"stage": "claude_narrative", "error": str(exc)}],
        }

    # Step 4 — hard override: replace Claude's results{} with authoritative values
    # Claude is explicitly told to return results as {}, but we override regardless.
    narrative["results"] = _extract_results_from_packet(packet)

    # Step 4b — deterministic validation (replaces Gemini QA gate)
    from app.services.report_validator import validate_report_package_integrity
    validation = validate_report_package_integrity(packet, narrative, case_id=case_id)
    human_review_required = validation.human_review_required
    stage_errors = (
        [{"stage": "report_validator", "error": f} for f in validation.failures]
        if validation.failures
        else []
    )

    # Step 5 — persist review flag (best-effort)
    tenant_id: str = getattr(
        getattr(request.state, "auth_context", None), "tenant_id", ""
    )
    _persist_review_flag(case_id, human_review_required=human_review_required, tenant_id=tenant_id)

    # Step 6 — fire Slack notification if human review required (BackgroundTask, post-response)
    if human_review_required and background_tasks is not None:
        _schedule_review_notification(
            case_id=case_id,
            packet=packet,
            flags=validation.failures,
            background_tasks=background_tasks,
        )

    return {
        "case_id": case_id,
        "final_narrative_json": narrative,
        "human_review_required": human_review_required,
        "stage_errors": stage_errors,
    }
