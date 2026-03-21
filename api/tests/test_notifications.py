"""
Unit tests for app/services/notifications.py

All tests mock the httpx.AsyncClient so no real network calls are made.
Tests run synchronously via asyncio.run() — no pytest-asyncio plugin required.

Coverage:
  - Slack payload shape when human_review_required is True
  - Resend payload shape (subject, body, auth header) when a report is approved
  - Silent no-op when SLACK_WEBHOOK_URL is absent
  - Silent no-op when RESEND_API_KEY is absent
  - Silent no-op when recipient_email is None
  - No exception raised when the HTTP call itself fails
"""
from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest


# ── Mock factory ──────────────────────────────────────────────────────────────

def _mock_client(status_code: int = 200, text: str = "ok") -> MagicMock:
    """Return a mock httpx.AsyncClient context-manager that records post() calls."""
    mock_response        = MagicMock()
    mock_response.status_code = status_code
    mock_response.text   = text

    client               = AsyncMock()
    client.post          = AsyncMock(return_value=mock_response)
    client.__aenter__    = AsyncMock(return_value=client)
    client.__aexit__     = AsyncMock(return_value=None)
    return client


# ── Flow 1: notify_review_required ───────────────────────────────────────────

class TestNotifyReviewRequired:
    """Slack internal-webhook notification for human_review_required."""

    def test_slack_called_with_correct_payload(self):
        """Webhook receives Block Kit JSON containing case ID, tenant name and flags."""
        from app.services.notifications import notify_review_required

        client = _mock_client()
        flags  = ["Missing calculation_method: goods_line abc-123 (cn_code=7208)"]

        with patch("app.services.notifications.httpx.AsyncClient", return_value=client):
            with patch.dict(
                os.environ,
                {"SLACK_WEBHOOK_URL": "https://hooks.slack.com/test-webhook"},
            ):
                asyncio.run(
                    notify_review_required(
                        case_id="case-001",
                        tenant_name="Acme Steel Ltd",
                        flags=flags,
                        base_url="https://app.nucleos.io",
                    )
                )

        client.post.assert_called_once()
        call_url  = client.post.call_args[0][0]
        payload   = client.post.call_args[1]["json"]

        assert call_url == "https://hooks.slack.com/test-webhook"
        # Top-level text fallback contains case ID and tenant name
        assert "case-001"       in payload["text"]
        assert "Acme Steel Ltd" in payload["text"]
        # Attachment has blocks
        blocks = payload["attachments"][0]["blocks"]
        # Metadata section: single section containing company name, case ID link, no duplicates
        meta_block = next(b for b in blocks if b["type"] == "section" and "text" in b)
        meta_text = meta_block["text"]["text"]
        assert "case-001"       in meta_text
        assert "Acme Steel Ltd" in meta_text
        # Issues section contains the flag string
        flag_block = next(
            b for b in blocks
            if b["type"] == "section" and "text" in b and flags[0] in b["text"]["text"]
        )
        assert flags[0] in flag_block["text"]["text"]
        # Action button deep-links to the case
        action_block = next(b for b in blocks if b["type"] == "actions")
        assert "case-001" in action_block["elements"][0]["url"]

    def test_no_op_when_webhook_url_not_set(self):
        """Returns silently — no HTTP call — when SLACK_WEBHOOK_URL is absent."""
        from app.services.notifications import notify_review_required

        client = _mock_client()

        with patch("app.services.notifications.httpx.AsyncClient", return_value=client):
            with patch.dict(os.environ, {"SLACK_WEBHOOK_URL": ""}):
                asyncio.run(
                    notify_review_required(
                        case_id="case-002",
                        tenant_name="Test Tenant",
                        flags=["some flag"],
                    )
                )

        client.post.assert_not_called()

    def test_no_raise_on_http_error(self):
        """Does not raise when the POST itself throws a network error."""
        from app.services.notifications import notify_review_required

        client          = AsyncMock()
        client.post     = AsyncMock(side_effect=httpx.ConnectTimeout("timeout"))
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__  = AsyncMock(return_value=None)

        with patch("app.services.notifications.httpx.AsyncClient", return_value=client):
            with patch.dict(
                os.environ,
                {"SLACK_WEBHOOK_URL": "https://hooks.slack.com/unreachable"},
            ):
                # Must not raise — fire-and-forget
                asyncio.run(
                    notify_review_required(
                        case_id="case-003",
                        tenant_name="Test Tenant",
                        flags=[],
                    )
                )

    def test_no_raise_on_non_200_response(self):
        """Logs error but does not raise when Slack returns a non-200 status."""
        from app.services.notifications import notify_review_required

        client = _mock_client(status_code=500, text="internal server error")

        with patch("app.services.notifications.httpx.AsyncClient", return_value=client):
            with patch.dict(
                os.environ,
                {"SLACK_WEBHOOK_URL": "https://hooks.slack.com/test"},
            ):
                asyncio.run(
                    notify_review_required(
                        case_id="case-004",
                        tenant_name="Tenant",
                        flags=["flag"],
                    )
                )  # Must not raise


# ── Flow 2: notify_report_ready ───────────────────────────────────────────────

class TestNotifyReportReady:
    """Resend email notification when a CBAM compliance report is approved."""

    def test_resend_called_with_correct_payload(self):
        """Resend API receives correct subject, from, to, text, html, and auth header."""
        from app.services.notifications import notify_report_ready

        client = _mock_client(status_code=200)

        with patch("app.services.notifications.httpx.AsyncClient", return_value=client):
            with patch.dict(
                os.environ,
                {
                    "RESEND_API_KEY":    "re_test_abc123",
                    "RESEND_FROM_EMAIL": "reports@nucleos.io",
                },
            ):
                asyncio.run(
                    notify_report_ready(
                        case_id="cbam-case-456",
                        recipient_email="importer@steelco.com",
                        period="Q1 2028",
                        total_liability_gbp_str="£44,540.00",
                        base_url="https://app.nucleos.io",
                    )
                )

        client.post.assert_called_once()
        call_url = client.post.call_args[0][0]
        payload  = client.post.call_args[1]["json"]
        headers  = client.post.call_args[1]["headers"]

        # Resend endpoint
        assert call_url == "https://api.resend.com/emails"

        # Recipients and sender
        assert payload["to"]   == ["importer@steelco.com"]
        assert payload["from"] == "reports@nucleos.io"

        # Subject contains the period
        assert "Q1 2028" in payload["subject"]

        # Plain text body contains key content
        assert "Q1 2028"       in payload["text"]
        assert "£44,540.00"    in payload["text"]
        assert "6 years"       in payload["text"]
        assert "cbam-case-456" in payload["text"] or "download" in payload["text"].lower()

        # HTML body contains the same
        assert "Q1 2028"       in payload["html"]
        assert "£44,540.00"    in payload["html"]
        assert "6" in payload["html"]   # "6 years" retention notice

        # Auth header carries the API key
        assert headers["Authorization"] == "Bearer re_test_abc123"

    def test_no_op_when_api_key_not_set(self):
        """Returns silently — no HTTP call — when RESEND_API_KEY is absent."""
        from app.services.notifications import notify_report_ready

        client = _mock_client()

        with patch("app.services.notifications.httpx.AsyncClient", return_value=client):
            with patch.dict(os.environ, {"RESEND_API_KEY": ""}):
                asyncio.run(
                    notify_report_ready(
                        case_id="case-007",
                        recipient_email="importer@example.com",
                        period="2027 Annual",
                        total_liability_gbp_str="£10,000.00",
                    )
                )

        client.post.assert_not_called()

    def test_no_op_when_recipient_email_is_none(self):
        """Returns silently — no HTTP call — when recipient_email is None."""
        from app.services.notifications import notify_report_ready

        client = _mock_client()

        with patch("app.services.notifications.httpx.AsyncClient", return_value=client):
            with patch.dict(os.environ, {"RESEND_API_KEY": "re_test_key"}):
                asyncio.run(
                    notify_report_ready(
                        case_id="case-008",
                        recipient_email=None,
                        period="2027 Annual",
                        total_liability_gbp_str="£0.00",
                    )
                )

        client.post.assert_not_called()

    def test_no_raise_on_http_error(self):
        """Does not raise when the POST throws a network error."""
        from app.services.notifications import notify_report_ready

        client          = AsyncMock()
        client.post     = AsyncMock(side_effect=httpx.ReadTimeout("timeout"))
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__  = AsyncMock(return_value=None)

        with patch("app.services.notifications.httpx.AsyncClient", return_value=client):
            with patch.dict(
                os.environ,
                {
                    "RESEND_API_KEY":    "re_test_key",
                    "RESEND_FROM_EMAIL": "reports@nucleos.io",
                },
            ):
                # Must not raise
                asyncio.run(
                    notify_report_ready(
                        case_id="case-009",
                        recipient_email="test@example.com",
                        period="Q2 2028",
                        total_liability_gbp_str="£5,000.00",
                    )
                )

    def test_download_url_uses_base_url(self):
        """The download link in the email body contains the provided base_url."""
        from app.services.notifications import notify_report_ready

        client = _mock_client()

        with patch("app.services.notifications.httpx.AsyncClient", return_value=client):
            with patch.dict(
                os.environ,
                {
                    "RESEND_API_KEY":    "re_test_key",
                    "RESEND_FROM_EMAIL": "reports@nucleos.io",
                },
            ):
                asyncio.run(
                    notify_report_ready(
                        case_id="case-010",
                        recipient_email="importer@example.com",
                        period="2027 Annual",
                        total_liability_gbp_str="£1,234.56",
                        base_url="https://my-instance.nucleos.io",
                    )
                )

        payload = client.post.call_args[1]["json"]
        assert "https://my-instance.nucleos.io/cases/case-010/download" in payload["text"]
        assert "https://my-instance.nucleos.io/cases/case-010/download" in payload["html"]
