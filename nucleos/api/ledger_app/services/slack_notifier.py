"""
Slack notification service for CBAM audit events.

Sends Slack messages, in the format shared with Arbor (contract/alerts), to an
Incoming Webhook when specific audit events are written to the ledger.  Fully opt-in — disabled unless
``SLACK_WEBHOOK_URL`` is set.

Configuration env vars
----------------------
SLACK_WEBHOOK_URL
    Slack Incoming Webhook URL.  Leave unset to disable all notifications.

SLACK_NOTIFY_EVENTS
    Comma-separated list of audit event types that trigger a notification.
    Default: ``human_review_required,pipeline_error``
    Set to ``all`` to notify on every audit event.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any
from urllib.parse import quote

from ledger_app.services.alert_format import Alert, nucleos_alert, render_slack

logger = logging.getLogger("ledger.slack")

_WEBHOOK_URL: str | None = os.getenv("SLACK_WEBHOOK_URL", "").strip() or None

_RAW_EVENTS = os.getenv(
    "SLACK_NOTIFY_EVENTS", "human_review_required,pipeline_error"
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


_STAGES = {
    "calculation": "The CBAM calculation",
    "document_parsing": "CBAM document parsing",
    "ingestion": "CBAM ingestion",
}

_ACRONYMS = {"eu": "EU", "uk": "UK", "xml": "XML", "cbam": "CBAM", "cpr": "CPR", "hmrc": "HMRC"}


def _case_link(case_id: str) -> tuple[str, str] | None:
    base = os.getenv("BASE_URL", "").strip().rstrip("/")
    if not base or case_id == "unknown":
        return None
    return ("Open the case", f"{base}/cbam/{quote(case_id, safe='')}")


def _event_words(event_type: str) -> str:
    words = [_ACRONYMS.get(w, w) for w in event_type.split("_")]
    first = words[0] if words[0] in _ACRONYMS.values() else words[0].capitalize()
    return " ".join([first, *words[1:]])


def _review_required(case_id: str, data: dict[str, Any]) -> Alert:
    issues = [str(i) for i in data.get("blocking_issues") or []]
    count = len(issues)
    facts = [("Case", case_id)]
    if issues:
        facts.append(("Missing fields", ", ".join(issues)))
    if data.get("score") is not None:
        facts.append(("Data quality score", str(data["score"])))
    missing = f"{count} required field{'s' if count != 1 else ''}" if count else "required fields"
    return nucleos_alert(
        "warning",
        "A CBAM report was stopped for missing data",
        f"The case is missing {missing}, so its report cannot be built until they are filled in.",
        facts=facts,
        action="Fill in the missing fields on the case, then build the report again.",
        link=_case_link(case_id),
        ref=data.get("run_id") or None,
    )


def _pipeline_error(case_id: str, data: dict[str, Any]) -> Alert:
    stage = str(data.get("stage") or "processing")
    # A traceback is unreadable in Slack; the whole error is in the logs and Sentry.
    first_line = str(data.get("error") or "Unknown error").strip().splitlines()[0]
    facts = [] if case_id == "unknown" else [("Case", case_id)]
    if data.get("filename"):
        facts.append(("File", str(data["filename"])))
    facts.append(("Error", first_line))
    return nucleos_alert(
        "critical",
        f"{_STAGES.get(stage, f'CBAM {stage}')} failed",
        "The case cannot move on until this step succeeds. The full error is in the Nucleos logs and Sentry.",
        facts=facts,
        link=_case_link(case_id),
    )


def _build_message(case_id: str, event_type: str, event_data: dict[str, Any]) -> dict:
    """The Slack payload for an audit event, in the format shared with Arbor."""
    if event_type == "human_review_required":
        alert = _review_required(case_id, event_data)
    elif event_type == "pipeline_error":
        alert = _pipeline_error(case_id, event_data)
    else:
        alert = nucleos_alert(
            "info",
            f"{_event_words(event_type)} on a CBAM case",
            "Recorded in the case's audit log.",
            facts=[("Case", case_id)],
            link=_case_link(case_id),
        )
    return render_slack(alert)


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
