import os
from typing import Any, Dict, Optional
import json
import importlib

from dotenv import load_dotenv

# Load environment variables from .env at startup
load_dotenv()


def _get_client() -> tuple[Any | None, str | None]:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return None, "missing_api_key"

    # Anthropic SDK has had multiple public client entrypoints across versions.
    # Resolve at call time so service boot does not depend on anthropic package.
    try:
        sdk = importlib.import_module("anthropic")
    except Exception:
        return None, "sdk_unavailable"

    anth_cls = getattr(sdk, "Anthropic", None)
    if anth_cls is None:
        return None, "sdk_unavailable"
    return anth_cls(api_key=api_key), None


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

def _validate_narrative_shape(narrative: Dict[str, Any]) -> None:
    required = [
        "executive_summary",
        "methodology",
        "results",
        "limitations",
        "open_gaps",
    ]
    for key in required:
        if key not in narrative:
            raise RuntimeError(f"Narrative missing required key: {key}")

    if not isinstance(narrative["results"], dict):
        raise RuntimeError("Narrative key 'results' must be an object.")
    if not isinstance(narrative["open_gaps"], list):
        raise RuntimeError("Narrative key 'open_gaps' must be a list.")


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

    client, unavailable_reason = _get_client()
    if client is None:
        # Graceful offline/no-sdk path: preserve payload exactly and signal skip.
        skipped = dict(draft_json)
        skipped["_review_status"] = "skipped"
        skipped["_review_provider"] = "claude"
        skipped["_review_reason"] = unavailable_reason or "unavailable"
        return skipped

    model = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest")

    try:
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
    except Exception:
        skipped = dict(draft_json)
        skipped["_review_status"] = "unavailable"
        skipped["_review_provider"] = "claude"
        skipped["_review_reason"] = "call_failed"
        return skipped

    reviewed = _extract_json(resp)

    _validate_narrative_shape(draft_json)

    # Defensive: ensure required top-level keys exist.
    for key in ["executive_summary", "methodology", "results", "limitations", "open_gaps"]:
        if key not in reviewed or reviewed.get(key) is None:
            reviewed[key] = draft_json.get(key)

    # Hard-guardrails for auditability:
    # Claude is NOT allowed to change structured numeric/content fields.
    # Force these to exactly match the draft payload to prevent rounding/drift.
    reviewed["results"] = draft_json.get("results")
    reviewed["open_gaps"] = draft_json.get("open_gaps")
    _validate_narrative_shape(reviewed)

    return reviewed
