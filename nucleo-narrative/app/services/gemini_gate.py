import json

from google import genai
from google.genai.types import GenerateContentConfig

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

def gate(packet: dict, narrative_json: dict) -> dict:
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
