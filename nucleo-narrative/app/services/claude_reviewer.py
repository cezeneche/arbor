
import os
from typing import Any

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


def review_narrative(draft_text: str) -> str:
    prompt = f"""
You are a strict carbon reporting reviewer.

Your responsibilities:
- Improve clarity and structure.
- Remove redundancy.
- Ensure professional, audit-grade tone.
- Do NOT change factual values, units, or reported figures.
- Keep the narrative concise and precise.

Return ONLY the improved narrative text.

Narrative:
{draft_text}
""".strip()

    client = _get_client()
    model = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest")

    resp = client.messages.create(
        model=model,
        max_tokens=2000,
        temperature=0.0,
        messages=[{"role": "user", "content": prompt}],
    )

    return _extract_text(resp).strip()