import json

from google import genai
from google.genai.types import GenerateContentConfig

from app.core.config import settings

def _gate_prompt(packet: dict, narrative_md: str) -> str:
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
        + "\n\nNARRATIVE:\n"
        + narrative_md
    )

def gate(packet: dict, narrative_md: str) -> dict:
    client = genai.Client(api_key=settings.gemini_api_key)
    resp = client.models.generate_content(
        model=settings.gemini_model,
        contents=_gate_prompt(packet, narrative_md),
        config=GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.0,
        ),
    )

    text = (getattr(resp, "text", None) or "").strip()

    # Defensive: sometimes models still wrap JSON in code fences.
    if text.startswith("```"):
        text = text.strip("`")
        # If a language tag remains (e.g., json), drop the first line
        if "\n" in text:
            text = text.split("\n", 1)[1].strip()

    try:
        data = json.loads(text)
    except Exception:
        return {"approved": False, "issues": [{"detail": "Gemini did not return valid JSON."}]}

    approved = bool(data.get("approved", False))
    issues = data.get("issues") if isinstance(data.get("issues"), list) else []
    return {"approved": approved, "issues": issues}
