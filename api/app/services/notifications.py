"""Fire-and-forget notification service for the Nucleos CBAM platform.

Flow 1 — notify_review_required
    Slack Block Kit POST to SLACK_WEBHOOK_URL when a narrative validation
    sets human_review_required = True.  Called via FastAPI BackgroundTasks from the
    narrative pipeline route so the HTTP response is returned first.

Flow 2 — notify_report_ready
    Transactional email via the Resend API (api.resend.com/emails) when a case is
    approved and the compliance_pack_v1 snapshot is finalised.  Also dispatched via
    BackgroundTasks from the review approval endpoint.

Design contract (both functions):
  - async — single httpx.AsyncClient POST per call
  - fire-and-forget: NEVER raise.  All errors are logged at ERROR level and swallowed.
  - no-op when the required env var is absent (SLACK_WEBHOOK_URL / RESEND_API_KEY)
  - no database access — callers are responsible for supplying context data

Env vars
--------
SLACK_WEBHOOK_URL  Slack Incoming Webhook for the internal compliance team.
RESEND_API_KEY     Resend secret key (re_live_… or re_test_…).
RESEND_FROM_EMAIL  Verified sender address (default: reports@nucleos.io).
SUPPORT_EMAIL      Nucleos support address shown in email footer (default: support@nucleos.io).
BASE_URL           Public application base URL, e.g. https://app.nucleos.io.
                   Used for building case deep-links if the caller does not
                   supply base_url explicitly.
"""
from __future__ import annotations

import logging
import os

import httpx

log = logging.getLogger("nucleos.notifications")

_CONNECT_TIMEOUT = 3.0
_READ_TIMEOUT    = 8.0


def _base_url() -> str:
    return os.getenv("BASE_URL", "").rstrip("/")


# ── Flow 1: internal Slack alert ───────────────────────────────────────────────

async def notify_review_required(
    case_id: str,
    tenant_name: str,
    flags: list[str],
    base_url: str = "",
) -> None:
    """POST a Slack Block Kit message when human_review_required is True.

    Parameters
    ----------
    case_id     : UUID string of the CBAM case.
    tenant_name : Importer display name (from cbam_cases.importer_name or
                  cbam_registration.business_name).
    flags       : List of human-readable failure strings from ValidationResult.failures.
    base_url    : Override for the application base URL used in the deep-link.
                  Falls back to the BASE_URL environment variable.
    """
    webhook_url = os.getenv("SLACK_WEBHOOK_URL", "").strip()
    if not webhook_url:
        log.warning(
            "notify_review_required: SLACK_WEBHOOK_URL is not set — skipping"
        )
        return

    effective_base = base_url or _base_url()
    case_url = (
        f"{effective_base}/cases/{case_id}" if effective_base else f"/cases/{case_id}"
    )
    flags_text = (
        "\n".join(f"• {f}" for f in flags) if flags else "No specific flags provided"
    )

    payload = {
        "text": f":rotating_light: Human Review Required — Case `{case_id}`",
        "attachments": [
            {
                "color": "#e01e5a",
                "blocks": [
                    {
                        "type": "header",
                        "text": {
                            "type": "plain_text",
                            "text": ":rotating_light: Human Review Required",
                        },
                    },
                    {
                        "type": "section",
                        "fields": [
                            {
                                "type": "mrkdwn",
                                "text": f"*Case ID:*\n<{case_url}|`{case_id}`>",
                            },
                            {
                                "type": "mrkdwn",
                                "text": f"*Tenant:*\n{tenant_name}",
                            },
                        ],
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*Flags triggering review:*\n{flags_text}",
                        },
                    },
                    {
                        "type": "actions",
                        "elements": [
                            {
                                "type": "button",
                                "text": {"type": "plain_text", "text": "Open Case"},
                                "url": case_url,
                                "style": "danger",
                            }
                        ],
                    },
                ],
            }
        ],
    }

    try:
        timeout = httpx.Timeout(
            connect=_CONNECT_TIMEOUT, read=_READ_TIMEOUT, write=5.0, pool=5.0
        )
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(webhook_url, json=payload)

        if resp.status_code != 200:
            log.error(
                "notify_review_required: Slack webhook returned status=%s body=%.200s "
                "case=%s",
                resp.status_code,
                resp.text,
                case_id,
            )
        else:
            log.info(
                "notify_review_required: sent to Slack case=%s tenant=%s flags=%d",
                case_id,
                tenant_name,
                len(flags),
            )
    except Exception as exc:
        log.error("notify_review_required: failed for case=%s: %s", case_id, exc)


# ── Flow 2: customer email via Resend ─────────────────────────────────────────

async def notify_report_ready(
    case_id: str,
    recipient_email: str | None,
    period: str,
    total_liability_gbp_str: str,
    base_url: str = "",
) -> None:
    """Send a Resend transactional email when a compliance report is approved.

    Parameters
    ----------
    case_id                 : UUID string of the CBAM case.
    recipient_email         : Importer contact email.  If None the call is skipped
                              with a warning — callers should resolve the email from
                              cbam_registration.business_address->>'email'.
    period                  : Human-readable accounting period, e.g. "2027 Annual"
                              or "Q1 2028".
    total_liability_gbp_str : Pre-formatted CBAM liability, e.g. "£44,540.00".
                              Callers that cannot compute the exact figure should
                              pass "See your compliance report".
    base_url                : Override for the application base URL used in the
                              download deep-link.  Falls back to BASE_URL env var.
    """
    if not recipient_email:
        log.warning(
            "notify_report_ready: no recipient email for case=%s — skipping", case_id
        )
        return

    api_key = os.getenv("RESEND_API_KEY", "").strip()
    if not api_key:
        log.warning("notify_report_ready: RESEND_API_KEY is not set — skipping")
        return

    from_email    = os.getenv("RESEND_FROM_EMAIL", "reports@nucleos.io").strip()
    support_email = os.getenv("SUPPORT_EMAIL",     "support@nucleos.io").strip()
    effective_base = base_url or _base_url()
    download_url = (
        f"{effective_base}/cases/{case_id}/download"
        if effective_base
        else f"/cases/{case_id}/download"
    )

    resend_payload = {
        "from":    from_email,
        "to":      [recipient_email],
        "subject": f"Your CBAM compliance report is ready — {period}",
        "text":    _build_plain_text(period, total_liability_gbp_str, download_url, support_email),
        "html":    _build_html(period, total_liability_gbp_str, download_url, support_email),
    }

    try:
        timeout = httpx.Timeout(
            connect=_CONNECT_TIMEOUT, read=_READ_TIMEOUT, write=5.0, pool=5.0
        )
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                json=resend_payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )

        if resp.status_code not in (200, 201):
            log.error(
                "notify_report_ready: Resend returned status=%s body=%.200s case=%s",
                resp.status_code,
                resp.text,
                case_id,
            )
        else:
            log.info(
                "notify_report_ready: email sent to=%s case=%s period=%s",
                recipient_email,
                case_id,
                period,
            )
    except Exception as exc:
        log.error("notify_report_ready: failed for case=%s: %s", case_id, exc)


# ── Email body builders ────────────────────────────────────────────────────────

def _build_plain_text(
    period: str,
    liability_str: str,
    download_url: str,
    support_email: str,
) -> str:
    return (
        "Your CBAM Compliance Report is Ready\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "Dear Importer,\n\n"
        f"Your CBAM compliance report for the accounting period {period} has been "
        "reviewed and finalised by our compliance team.\n\n"
        f"  Accounting period   : {period}\n"
        f"  Total CBAM liability: {liability_str}\n\n"
        f"Download your report:\n{download_url}\n\n"
        "RECORDS RETENTION NOTICE\n"
        "Under UK CBAM legislation (Finance No.2 Bill 2025-26), you are required\n"
        "to retain all records and supporting documentation for a minimum of 6 years\n"
        "from the date of submission.\n\n"
        f"Questions? Contact us at {support_email}\n\n"
        f"Nucleos — nucleos.io | {support_email}\n"
    )


def _build_html(
    period: str,
    liability_str: str,
    download_url: str,
    support_email: str,
) -> str:
    return (
        "<!DOCTYPE html>\n"
        "<html><head>\n"
        '  <meta charset="utf-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        "  <style>\n"
        "    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"
        "color:#1a1a2e;margin:0;padding:0;background:#f1f5f9}\n"
        "    .wrap{max-width:560px;margin:32px auto;padding:0 16px}\n"
        "    .hdr{background:#0F172A;padding:20px 28px;border-radius:8px 8px 0 0}\n"
        "    .hdr h1{color:#14B8A6;font-size:18px;margin:0;letter-spacing:-0.02em}\n"
        "    .body{background:#fff;padding:28px 32px;border:1px solid #e2e8f0;"
        "border-top:none;border-radius:0 0 8px 8px}\n"
        "    .body h2{margin-top:0;font-size:20px;color:#0F172A}\n"
        "    .kv{background:#f8fafc;border-radius:6px;padding:16px 20px;margin:20px 0}\n"
        "    .kv-row{margin:0 0 12px}\n"
        "    .kv-row:last-child{margin:0}\n"
        "    .kv-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;"
        "color:#64748b;margin:0 0 2px}\n"
        "    .kv-value{font-size:17px;font-weight:700;color:#0F172A;margin:0}\n"
        "    .btn{display:inline-block;background:#14B8A6;color:#fff;padding:13px 26px;"
        "border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;margin:16px 0}\n"
        "    .notice{background:#fffbeb;border-left:3px solid #F59E0B;padding:12px 16px;"
        "border-radius:0 4px 4px 0;font-size:13px;color:#78350f;margin:20px 0}\n"
        "    .notice strong{color:#92400e}\n"
        "    .footer{font-size:11px;color:#94a3b8;margin-top:24px;text-align:center;"
        "padding:0 0 24px}\n"
        "    .footer a{color:#14B8A6;text-decoration:none}\n"
        "  </style>\n"
        "</head><body>\n"
        '  <div class="wrap">\n'
        '    <div class="hdr"><h1>Nucleos &mdash; CBAM Compliance</h1></div>\n'
        '    <div class="body">\n'
        "      <h2>Your compliance report is ready</h2>\n"
        f"      <p>Your CBAM compliance report for the accounting period "
        f"<strong>{period}</strong> has been reviewed and finalised by our compliance team.</p>\n"
        '      <div class="kv">\n'
        '        <div class="kv-row">\n'
        '          <p class="kv-label">Accounting period</p>\n'
        f'          <p class="kv-value">{period}</p>\n'
        "        </div>\n"
        '        <div class="kv-row">\n'
        '          <p class="kv-label">Total CBAM liability</p>\n'
        f'          <p class="kv-value">{liability_str}</p>\n'
        "        </div>\n"
        "      </div>\n"
        f'      <a href="{download_url}" class="btn">Download Report</a>\n'
        '      <div class="notice">\n'
        "        <strong>Records retention requirement</strong><br>\n"
        "        Under UK CBAM legislation (Finance No.2 Bill 2025-26), you must retain all\n"
        "        records and supporting documentation for a minimum of\n"
        "        <strong>6&nbsp;years</strong> from the date of submission.\n"
        "      </div>\n"
        '      <p style="font-size:14px;color:#475569">\n'
        f'        Questions? Contact <a href="mailto:{support_email}">{support_email}</a>.\n'
        "      </p>\n"
        "    </div>\n"
        '    <div class="footer">\n'
        "      Nucleos &mdash;\n"
        '      <a href="https://nucleos.io">nucleos.io</a> &mdash;\n'
        f'      <a href="mailto:{support_email}">{support_email}</a>\n'
        "    </div>\n"
        "  </div>\n"
        "</body></html>"
    )
