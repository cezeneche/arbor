"""The one Slack format shared with Arbor (src/lib/alerts/format.ts).

Both renderers are tested against contract/alerts/golden.json, which also holds
the rules. Change the golden file first.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

Severity = Literal["critical", "warning", "info", "resolved"]

_SEVERITY = {
    "critical": ("Action needed", ":red_circle:"),
    "warning": ("Warning", ":large_orange_circle:"),
    "info": ("Update", ":large_blue_circle:"),
    "resolved": ("Resolved", ":large_green_circle:"),
}

_MAX_TITLE = 150
_MAX_SUMMARY = 1500
_MAX_FACT = 500
_MAX_FACTS = 10  # Slack rejects a section with more fields
_MAX_BUTTON = 75

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@dataclass(frozen=True)
class Alert:
    severity: Severity
    source: str
    environment: str
    title: str
    summary: str
    at: datetime
    facts: list[tuple[str, str]] = field(default_factory=list)
    action: str | None = None
    link: tuple[str, str] | None = None
    ref: str | None = None


def nucleos_alert(severity: Severity, title: str, summary: str, **fields) -> Alert:
    """An alert from Nucleos, stamped with this deployment's environment and the time now."""
    environment = os.getenv("VERCEL_ENV") or os.getenv("ENVIRONMENT") or "development"
    return Alert(
        severity=severity,
        source="Nucleos",
        environment=environment,
        title=title,
        summary=summary,
        at=datetime.now(timezone.utc),
        **fields,
    )


def _cut(value: str, limit: int) -> str:
    return value if len(value) <= limit else value[: limit - 1] + "…"


def _escape(value: str) -> str:
    # Slack's three control characters: outside text can never ping @channel or forge a link.
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _utc(at: datetime) -> str:
    at = at.astimezone(timezone.utc)
    return f"{at.day} {_MONTHS[at.month - 1]} {at.year}, {at.hour:02d}:{at.minute:02d} UTC"


def _mrkdwn(text: str) -> dict:
    return {"type": "mrkdwn", "text": text}


def render_slack(alert: Alert) -> dict:
    label, marker = _SEVERITY[alert.severity]
    title = _escape(_cut(alert.title, _MAX_TITLE))
    summary = _escape(_cut(alert.summary, _MAX_SUMMARY))

    blocks: list[dict] = [
        {"type": "context", "elements": [_mrkdwn(f"{marker} *{label}* · {alert.source} · {alert.environment}")]},
        {"type": "section", "text": _mrkdwn(f"*{title}*\n{summary}")},
    ]
    facts = alert.facts[:_MAX_FACTS]
    if facts:
        blocks.append(
            {
                "type": "section",
                "fields": [
                    _mrkdwn(f"*{_escape(_cut(k, _MAX_FACT))}*\n{_escape(_cut(v, _MAX_FACT))}") for k, v in facts
                ],
            }
        )
    if alert.action:
        blocks.append({"type": "section", "text": _mrkdwn(f"*What to do*\n{_escape(_cut(alert.action, _MAX_SUMMARY))}")})
    if alert.link and re.match(r"^https?://", alert.link[1], re.IGNORECASE):
        button_label, url = alert.link
        blocks.append(
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": _cut(button_label, _MAX_BUTTON), "emoji": False},
                        "url": url,
                        "style": "primary",
                    }
                ],
            }
        )
    ref = f" · ref `{_escape(alert.ref)}`" if alert.ref else ""
    blocks.append({"type": "context", "elements": [_mrkdwn(f"{_utc(alert.at)}{ref}")]})

    return {"text": f"{label}: {title}", "blocks": blocks}
