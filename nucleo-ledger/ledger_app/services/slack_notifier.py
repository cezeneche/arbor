"""
Slack notification service for CBAM audit events.

Sends Slack Block Kit messages to an Incoming Webhook when specific audit
events are written to the ledger.  Fully opt-in — disabled unless
``SLACK_WEBHOOK_URL`` is configured.

Secret resolution order
-----------------------
1. AWS Secrets Manager (when ``AWS_SECRET_NAME`` is set) — preferred in production
2. ``SLACK_WEBHOOK_URL`` environment variable / ``.env`` file — local dev fallback

Other configuration
-------------------
SLACK_NOTIFY_EVENTS
    Comma-separated list of audit event types that trigger a notification.
    Default: ``human_review_required,cbam_calculation_completed``
    Set to ``all`` to notify on every audit event.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any

logger = logging.getLogger("ledger.slack")


def _resolve_webhook_url() -> str | None:
    """Resolve SLACK_WEBHOOK_URL via AWS Secrets Manager then env var fallback."""
    try:
        from ledger_app.core.secrets import get_secret
        return get_secret("SLACK_WEBHOOK_URL", required=False) or None
    except Exception:
        return (os.getenv("SLACK_WEBHOOK_URL") or "").strip() or None


_WEBHOOK_URL: str | None = _resolve_webhook_url()

_RAW_EVENTS = os.getenv(
    "SLACK_NOTIFY_EVENTS", "human_review_required,cbam_calculation_completed"
)
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


def _build_message(case_id: str, event_type: str, event_data: dict[str, Any]) -> dict:
    """Build a Slack Block Kit message payload for the given audit event."""

    if event_type == "human_review_required":
        blocking = event_data.get("blocking_issues") or []
        issues_text = ", ".join(str(i) for i in blocking) if blocking else "—"
        run_id = event_data.get("run_id") or "—"
        return {
            "text": f"\U0001f6a8 Human Review Required \u2014 Case `{case_id}`",
            "attachments": [
                {
                    "color": "#e01e5a",
                    "blocks": [
                        {
                            "type": "header",
                            "text": {
                                "type": "plain_text",
                                "text": "\U0001f6a8 Human Review Required",
                            },
                        },
                        {
                            "type": "section",
                            "fields": [
                                {"type": "mrkdwn", "text": f"*Case ID:*\n`{case_id}`"},
                                {
                                    "type": "mrkdwn",
                                    "text": f"*Risk Tier:*\n`{event_data.get('risk_tier', 'blocking')}`",
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": f"*Score:*\n{event_data.get('score', '—')}",
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": f"*Blocking Issues:*\n{issues_text}",
                                },
                            ],
                        },
                        {
                            "type": "context",
                            "elements": [
                                {
                                    "type": "mrkdwn",
                                    "text": f"Run ID: `{run_id}` \u2502 Source: CBAM ledger",
                                }
                            ],
                        },
                    ],
                }
            ],
        }

    if event_type == "cbam_calculation_completed":
        run_id = event_data.get("run_id") or "—"
        return {
            "text": f"\u2705 CBAM Calculation Complete \u2014 Case `{case_id}`",
            "attachments": [
                {
                    "color": "#2eb886",
                    "blocks": [
                        {
                            "type": "header",
                            "text": {
                                "type": "plain_text",
                                "text": "\u2705 CBAM Calculation Complete",
                            },
                        },
                        {
                            "type": "section",
                            "fields": [
                                {"type": "mrkdwn", "text": f"*Case ID:*\n`{case_id}`"},
                                {
                                    "type": "mrkdwn",
                                    "text": f"*Origin Country:*\n{event_data.get('origin_country', '—')}",
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": f"*Net Liability (tCO\u2082e):*\n{event_data.get('net_liability_tco2e', '—')}",
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": f"*CBAM Certificates:*\n{event_data.get('cbam_certificates', '—')}",
                                },
                            ],
                        },
                        {
                            "type": "context",
                            "elements": [
                                {
                                    "type": "mrkdwn",
                                    "text": (
                                        f"Run ID: `{run_id}`"
                                        f" \u2502 Table: {event_data.get('emission_factor_table', '—')}"
                                    ),
                                }
                            ],
                        },
                    ],
                }
            ],
        }

    # Generic fallback for any other event type
    run_id = event_data.get("run_id") or "—"
    return {
        "text": f"\U0001f4cb CBAM Event: `{event_type}` \u2014 Case `{case_id}`",
        "attachments": [
            {
                "color": "#36a64f",
                "blocks": [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*Event:* `{event_type}`\n*Case:* `{case_id}`",
                        },
                    },
                    {
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": f"Run ID: `{run_id}` \u2502 Source: CBAM ledger",
                            }
                        ],
                    },
                ],
            }
        ],
    }


def notify(case_id: str, event_type: str, event_data: dict[str, Any]) -> None:
    """Send a Slack notification for a CBAM audit event.

    Silent no-op when:
    - ``SLACK_WEBHOOK_URL`` is not configured
    - ``event_type`` is not in ``SLACK_NOTIFY_EVENTS``
    - any network or HTTP error occurs
    """
    if not _should_notify(event_type):
        return

    try:
        import httpx

        payload = _build_message(case_id, event_type, event_data)
        timeout = httpx.Timeout(
            connect=_CONNECT_TIMEOUT, read=_READ_TIMEOUT, write=5.0, pool=5.0
        )

        with httpx.Client(timeout=timeout) as client:
            for attempt in range(1, _MAX_ATTEMPTS + 1):
                try:
                    resp = client.post(_WEBHOOK_URL, json=payload)
                    if resp.status_code == 200:
                        return
                    if resp.status_code < 500:
                        logger.warning(
                            "Slack webhook rejected event=%s case=%s status=%s body=%.200s",
                            event_type,
                            case_id,
                            resp.status_code,
                            resp.text,
                        )
                        return
                    # 5xx — back off and retry
                    if attempt < _MAX_ATTEMPTS:
                        time.sleep(0.5 * attempt)
                except httpx.TransportError:
                    if attempt < _MAX_ATTEMPTS:
                        time.sleep(0.5 * attempt)
                    # Last attempt — fall through to outer except
    except Exception as exc:
        logger.warning(
            "Slack notification failed event=%s case=%s: %s",
            event_type,
            case_id,
            exc,
        )
