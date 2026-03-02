import json
from decimal import Decimal, InvalidOperation
from typing import Any

from app.core.config import settings

def _gate_prompt(packet: dict, narrative_json: dict) -> str:
    return (
        "You are the final QA gate for an audit-ready emissions narrative.\n"
        "Check:\n"
        "- No invented numbers or documents.\n"
        "- Narrative aligns with packet results and data quality.\n"
        "- Gaps/conflicts are correctly stated.\n"
        "If acceptable: approved=true.\n"
        "If not: approved=false and list specific issues.\n\n"
        "Return ONLY valid JSON with keys:\n"
        '{ "approved": true|false, "issues": [ {"detail": "..."} ] }\n\n'
        "JSON packet:\n"
        + json.dumps(packet, indent=2)
        + "\n\nNARRATIVE JSON:\n"
        + json.dumps(narrative_json, indent=2)
    )

def _extract_text(resp) -> str:
    """Best-effort extraction of model text across SDK response shapes."""
    text = (getattr(resp, "text", None) or "").strip()
    if text:
        return text

    # Fallback: walk common response fields
    candidates = getattr(resp, "candidates", None) or []
    if candidates:
        content = getattr(candidates[0], "content", None)
        parts = getattr(content, "parts", None) or []
        if parts:
            part_text = getattr(parts[0], "text", None) or ""
            return str(part_text).strip()

    return ""

def _validate_narrative_shape(narrative_json: dict) -> list[dict]:
    issues: list[dict] = []
    for key in ["executive_summary", "methodology", "results", "limitations", "open_gaps"]:
        if key not in narrative_json:
            issues.append({"detail": f"Narrative missing required key: {key}"})
    if "results" in narrative_json and not isinstance(narrative_json.get("results"), dict):
        issues.append({"detail": "Narrative key 'results' must be an object."})
    if "open_gaps" in narrative_json and not isinstance(narrative_json.get("open_gaps"), list):
        issues.append({"detail": "Narrative key 'open_gaps' must be a list."})
    return issues


def _to_decimal(value: Any) -> Decimal | None:
    if isinstance(value, (int, float, str, Decimal)):
        try:
            return Decimal(str(value))
        except (InvalidOperation, ValueError):
            return None
    return None


def _expected_results(packet: dict) -> dict[str, Decimal | int]:
    if packet.get("type") == "cbam_report_package_v1":
        summary = packet.get("summary") or {}
        return {
            "total_direct_embedded_kgco2e": _to_decimal(summary.get("total_direct_emissions_kgco2e")) or Decimal("0"),
            "total_indirect_embedded_kgco2e": _to_decimal(summary.get("total_indirect_emissions_kgco2e")) or Decimal("0"),
            "total_embedded_kgco2e": _to_decimal(summary.get("total_embedded_emissions_kgco2e")) or Decimal("0"),
            "total_net_mass_kg": _to_decimal(summary.get("total_net_mass_kg")) or Decimal("0"),
            "goods_lines_count": int(summary.get("total_goods_lines") or 0),
        }

    results = packet.get("results") or {}
    return {
        "total_emissions_kgco2e": _to_decimal(results.get("total_kgco2e")) or Decimal("0"),
        "scope_1_kgco2e": _to_decimal(results.get("scope_1_natural_gas_kgco2e")) or Decimal("0"),
        "scope_2_kgco2e": _to_decimal(results.get("scope_2_electricity_kgco2e")) or Decimal("0"),
        "intensity_kgco2e_per_unit": _to_decimal(results.get("kgco2e_per_unit")) or Decimal("0"),
    }


def _strict_numeric_issues(packet: dict, narrative_json: dict) -> list[dict]:
    issues: list[dict] = []
    expected = _expected_results(packet)
    got_results = narrative_json.get("results")
    if not isinstance(got_results, dict):
        return [{"detail": "Narrative key 'results' must be an object."}]

    for key, expected_value in expected.items():
        if key not in got_results:
            issues.append({"detail": f"Narrative results missing key: {key}"})
            continue

        got_value = got_results.get(key)
        if isinstance(expected_value, int):
            if not isinstance(got_value, (int, float)) or int(got_value) != expected_value:
                issues.append(
                    {
                        "detail": (
                            f"Numeric mismatch for results.{key}: "
                            f"expected {expected_value}, got {got_value}"
                        )
                    }
                )
            continue

        got_decimal = _to_decimal(got_value)
        if got_decimal is None or got_decimal != expected_value:
            issues.append(
                {
                    "detail": (
                        f"Numeric mismatch for results.{key}: "
                        f"expected {expected_value}, got {got_value}"
                    )
                }
            )

    return issues


def gate(packet: dict, narrative_json: dict) -> dict:
    local_shape_issues = _validate_narrative_shape(narrative_json)
    local_numeric_issues = _strict_numeric_issues(packet, narrative_json)
    local_issues = local_shape_issues + local_numeric_issues

    if local_issues:
        return {"approved": False, "issues": local_issues}

    if not settings.gemini_api_key:
        return {
            "approved": False,
            "issues": [{"detail": "GEMINI_API_KEY is missing; Gemini gate not executed."}],
        }

    try:
        try:
            import google.genai as genai
            from google.genai.types import GenerateContentConfig
        except Exception:
            # Compatibility fallback for environments where `google-genai`
            # exposes `genai` as `from google import genai`.
            from google import genai  # type: ignore
            from google.genai.types import GenerateContentConfig  # type: ignore
    except Exception:
        return {
            "approved": False,
            "issues": [{"detail": "google-genai is not installed; Gemini gate not executed."}],
        }

    client = genai.Client(api_key=settings.gemini_api_key)
    resp = client.models.generate_content(
        model=settings.gemini_model,
        contents=_gate_prompt(packet, narrative_json),
        config=GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.0,
        ),
    )

    text = _extract_text(resp)

    # Defensive: sometimes models still wrap JSON in code fences.
    if text.startswith("```"):
        lines = text.splitlines()
        # Drop opening fence line (e.g., ``` or ```json)
        if lines:
            lines = lines[1:]
        # Drop trailing fence if present
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        data = json.loads(text)
    except Exception:
        preview = text[:500] + ("..." if len(text) > 500 else "")
        return {
            "approved": False,
            "issues": [{"detail": "Gemini did not return valid JSON.", "raw_preview": preview}],
        }

    approved = bool(data.get("approved", False))

    raw_issues = data.get("issues")
    issues = raw_issues if isinstance(raw_issues, list) else []

    # Normalise issues to a list of {"detail": "..."}
    normalised = []
    for it in issues:
        if isinstance(it, dict) and isinstance(it.get("detail"), str):
            normalised.append({"detail": it.get("detail")})
        elif isinstance(it, str):
            normalised.append({"detail": it})

    return {"approved": approved, "issues": normalised}
