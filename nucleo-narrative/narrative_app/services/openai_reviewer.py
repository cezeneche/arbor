import json
from openai import OpenAI
from narrative_app.core.config import settings

def _review_prompt(packet: dict, draft_md: str) -> str:
    return (
        "You are a strict auditor and technical editor.\n"
        "You must:\n"
        "1) Improve clarity/structure.\n"
        "2) Ensure every number and claim is supported by the JSON packet.\n"
        "3) If the draft contains unsupported claims, remove them.\n"
        "4) If a critical inconsistency remains that cannot be fixed without guessing, set human_review_required=true.\n\n"
        "Return ONLY valid JSON with keys:\n"
        "{\n"
        '  \"human_review_required\": true|false,\n'
        '  \"issues\": [ {\"type\": \"...\", \"detail\": \"...\"} ],\n'
        '  \"revised_narrative_md\": \"...\"\n'
        "}\n\n"
        "JSON packet:\n"
        + json.dumps(packet, indent=2)
        + "\n\nDRAFT:\n"
        + draft_md
    )

def review_and_revise(packet: dict, draft_md: str) -> dict:
    client = OpenAI(api_key=settings.openai_api_key)
    resp = client.responses.create(
        model=settings.openai_model,
        input=_review_prompt(packet, draft_md),
        temperature=0.0,
    )
    text = resp.output_text or "{}"
    try:
        return json.loads(text)
    except Exception:
        return {
            "human_review_required": True,
            "issues": [{"type": "invalid_json", "detail": "Reviewer did not return valid JSON."}],
            "revised_narrative_md": draft_md,
        }
