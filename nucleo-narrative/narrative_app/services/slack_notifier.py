"""
Slack notification service for narrative pipeline jobs (async).

Sends a Slack Block Kit message when an ARQ pipeline job completes or fails.
Fully opt-in — disabled unless ``SLACK_WEBHOOK_URL`` is configured.

Secret resolution order
-----------------------
1. AWS Secrets Manager (when ``AWS_SECRET_NAME`` is set) — preferred in production
2. ``SLACK_WEBHOOK_URL`` environment variable / ``.env`` file — local dev fallback

Other configuration
-------------------
SLACK_NOTIFY_EVENTS
    Comma-separated event types that trigger notifications.
    Use ``pipeline_completed`` (default) for job-done messages.
    Set to ``all`` to catch any future event types.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

logger = logging.getLogger("narrative.slack")


def _resolve_webhook_url() -> str | None:
    """Resolve SLACK_WEBHOOK_URL via AWS Secrets Manager then env var fallback."""
    try:
        from narrative_app.core.secrets import get_secret
        return get_secret("SLACK_WEBHOOK_URL", required=False) or None
    except Exception:
        return (os.getenv("SLACK_WEBHOOK_URL") or "").strip() or None


_WEBHOOK_URL: str | None = _resolve_webhook_url()

_RAW_EVENTS = os.getenv("SLACK_NOTIFY_EVENTS", "pipeline_completed")
_NOTIFY_EVENTS: set[str] | None = (
    None  # None == "all"
    if _RAW_EVENTS.strip().lower() == "all"
    else {e.strip() for e in _RAW_EVENTS.split(",") if e.strip()}
)

_CONNECT_TIMEOUT = 3.0
_READ_TIMEOUT = 5.0
_MAX_ATTEMPTS = 2


def _should_notify(event_type: str) -> bool:
    if not _WEBHOOK_URL:
        return False
    if _NOTIFY_EVENTS is None:
        return True
    return event_type in _NOTIFY_EVENTS


def _build_pipeline_message(
    case_id: str,
    job_id: str,
    success: bool,
    result: dict[str, Any] | None,
) -> dict:
    """Build a Slack Block Kit payload for a pipeline job result."""
    if success:
        human_review = bool((result or {}).get("human_review_required"))
        color = "#f2c744" if human_review else "#2eb886"
        icon = "\u26a0\ufe0f" if human_review else "\u2705"
        status_label = (
            "Human Review Required" if human_review else "Complete"
        )
        header_text = f"{icon} Narrative Pipeline {status_label}"
        summary_text = f"{icon} Narrative Pipeline {status_label} \u2014 Case `{case_id}`"
    else:
        color = "#e01e5a"
        header_text = "\u274c Narrative Pipeline Failed"
        summary_text = f"\u274c Narrative Pipeline Failed \u2014 Case `{case_id}`"

    return {
        "text": summary_text,
        "attachments": [
            {
                "color": color,
                "blocks": [
                    {
                        "type": "header",
                        "text": {"type": "plain_text", "text": header_text},
                    },
                    {
                        "type": "section",
                        "fields": [
                            {"type": "mrkdwn", "text": f"*Case ID:*\n`{case_id}`"},
                            {"type": "mrkdwn", "text": f"*Job ID:*\n`{job_id}`"},
                        ],
                    },
                ],
            }
        ],
    }


async def notify_pipeline(
    case_id: str,
    job_id: str,
    *,
    success: bool,
    result: dict[str, Any] | None = None,
) -> None:
    """Async Slack notification for pipeline job completion.

    Silent no-op when ``SLACK_WEBHOOK_URL`` is not configured or any
    network error occurs.  Never raises.
    """
    if not _should_notify("pipeline_completed"):
        return

    try:
        import httpx

        payload = _build_pipeline_message(case_id, job_id, success, result)
        timeout = httpx.Timeout(
            connect=_CONNECT_TIMEOUT, read=_READ_TIMEOUT, write=5.0, pool=5.0
        )

        async with httpx.AsyncClient(timeout=timeout) as client:
            for attempt in range(1, _MAX_ATTEMPTS + 1):
                try:
                    resp = await client.post(_WEBHOOK_URL, json=payload)
                    if resp.status_code == 200:
                        return
                    if resp.status_code < 500:
                        logger.warning(
                            "Slack webhook rejected pipeline notification "
                            "case=%s status=%s body=%.200s",
                            case_id,
                            resp.status_code,
                            resp.text,
                        )
                        return
                    # 5xx — back off and retry
                    if attempt < _MAX_ATTEMPTS:
                        await asyncio.sleep(0.5 * attempt)
                except httpx.TransportError:
                    if attempt < _MAX_ATTEMPTS:
                        await asyncio.sleep(0.5 * attempt)
    except Exception as exc:
        logger.warning(
            "Slack notification failed case=%s job=%s: %s", case_id, job_id, exc
        )
