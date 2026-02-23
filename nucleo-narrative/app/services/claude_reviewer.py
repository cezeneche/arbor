import os
from typing import Any, Dict, Optional
import json

from dotenv import load_dotenv

# Load environment variables from .env at startup
load_dotenv()

# Anthropic SDK has had multiple public client entrypoints across versions.
# This wrapper supports both:
# - Newer SDK: from anthropic import Anthropic
# - Older SDK: import anthropic; anthropic.Anthropic(...)
try:
    from anthropic import Anthropic  # type: ignore
except Exception:  # pragma: no cover
    Anthropic = None  # type: ignore
    import anthropic  # type: ignore


def _get_client():
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is missing. Add it to nucleo-narrative/.env and restart the server."
        )

    if Anthropic is not None:
        return Anthropic(api_key=api_key)

    # Fallback for older SDKs
    return anthropic.Anthropic(api_key=api_key)  # type: ignore


def _extract_text(resp: Any) -> str:
    """
    Anthropic responses typically have resp.content as a list of blocks.
    We join all text blocks defensively.
    """
    blocks = getattr(resp, "content", None) or []
    texts = []
    for b in blocks:
        t = getattr(b, "text", None)
        if t:
            texts.append(t)
    if texts:
        return "\n".join(texts)

    # Last resort: stringify
    return str(resp)


def _extract_json(resp: Any) -> Dict[str, Any]:
    """Extract and parse JSON from an Anthropic response."""
    text = _extract_text(resp).strip()
    try:
        return json.loads(text)
    except Exception as e:
        # Surface a short snippet for debugging without dumping huge payloads
        snippet = text[:500]
        raise RuntimeError(f"Claude did not return valid JSON: {e}. Snippet: {snippet}")


def review_narrative(draft_json: Dict[str, Any]) -> Dict[str, Any]:
    """
    Claude acts as a strict reviewer/editor.

    Input: a structured narrative JSON object.
    Output: the same structure, improved prose, with factual/numeric values preserved.
    """

    prompt = (
        "You are a strict carbon reporting reviewer.\n\n"
        "You will receive a JSON object representing a narrative.\n\n"
        "Your responsibilities:\n"
        "- Improve clarity and structure of prose fields (executive_summary, methodology, limitations).\n"
        "- Ensure professional, audit-grade tone.\n"
        "- Remove redundancy.\n"
        "- Do NOT change factual values, numbers, units, IDs, dates, or any values inside results/open_gaps.\n"
        "- Preserve keys and overall JSON shape.\n\n"
        "Return ONLY valid minified JSON (no markdown, no commentary).\n\n"
        "JSON:\n"
    )

    client = _get_client()
    model = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest")

    resp = client.messages.create(
        model=model,
        max_tokens=2000,
        temperature=0.0,
        messages=[
            {
                "role": "user",
                "content": prompt + json.dumps(draft_json, ensure_ascii=False),
            }
        ],
    )

    reviewed = _extract_json(resp)

    # Defensive: ensure required top-level keys exist.
    for key in ["executive_summary", "methodology", "limitations"]:
        if key not in reviewed or reviewed.get(key) is None:
            reviewed[key] = draft_json.get(key)

    # Hard-guardrails for auditability:
    # Claude is NOT allowed to change structured numeric/content fields.
    # Force these to exactly match the draft payload to prevent rounding/drift.
    reviewed["results"] = draft_json.get("results")
    reviewed["open_gaps"] = draft_json.get("open_gaps")

    return reviewed