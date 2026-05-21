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
        "\n".join(f"• {f}" for f in flags) if flags else "_No specific flags provided_"
    )

    issue_count = len(flags)
    issue_label = f"*:warning: {issue_count} issue{'s' if issue_count != 1 else ''} requiring review:*"

    payload = {
        # Fallback text carries all identity info — attachment blocks do not repeat it
        "text": f":rotating_light: Human Review Required — *{tenant_name}* (Case `{case_id}`)",
        "attachments": [
            {
                "color": "#e01e5a",
                "blocks": [
                    # Issues list — no header or metadata repeated from the top line
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"{issue_label}\n{flags_text}",
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


# ── Flow 2: supplier form invitation via Resend ───────────────────────────────

async def notify_supplier_form(
    supplier_email: str,
    form_url: str,
    cn_code: str,
    importer_name: str,
    expires_days: int = 30,
) -> None:
    """Send the tokenised supplier form link to the installation contact.

    Fire-and-forget — never raises. No-op when RESEND_API_KEY is absent.
    """
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    if not api_key:
        log.warning("notify_supplier_form: RESEND_API_KEY not set — skipping")
        return

    from_email    = os.getenv("RESEND_FROM_EMAIL", "reports@nucleos.io").strip()
    support_email = os.getenv("SUPPORT_EMAIL",     "support@nucleos.io").strip()

    payload = {
        "from":    from_email,
        "to":      [supplier_email],
        "subject": f"CBAM emissions data request — {cn_code}",
        "text":    _build_supplier_form_plain(cn_code, importer_name, form_url, expires_days, support_email),
        "html":    _build_supplier_form_html(cn_code, importer_name, form_url, expires_days, support_email),
    }

    try:
        timeout = httpx.Timeout(connect=_CONNECT_TIMEOUT, read=_READ_TIMEOUT, write=5.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if resp.status_code not in (200, 201):
            log.error(
                "notify_supplier_form: Resend status=%s body=%.200s email=%s",
                resp.status_code, resp.text, supplier_email,
            )
        else:
            log.info("notify_supplier_form: sent to=%s cn_code=%s", supplier_email, cn_code)
    except Exception as exc:
        log.error("notify_supplier_form: failed email=%s: %s", supplier_email, exc)


def _build_supplier_form_plain(
    cn_code: str,
    importer_name: str,
    form_url: str,
    expires_days: int,
    support_email: str,
) -> str:
    return (
        f"CBAM Emissions Data Request — {cn_code}\n\n"
        f"{importer_name} has requested your facility's emissions data for UK CBAM compliance.\n\n"
        "Please submit the following:\n"
        "  - Specific embedded emissions (SEE) in tCO₂e per tonne of product\n"
        "  - Production route (e.g. electric arc furnace, blast furnace)\n"
        "  - Facility name\n\n"
        "Open the form here:\n"
        f"{form_url}\n\n"
        f"This link expires in {expires_days} days and can only be used once.\n"
        "No account or login is required.\n\n"
        "Once submitted, the data will be used by the importer to calculate their CBAM liability.\n\n"
        f"Questions? Contact {support_email}\n"
        f"Nucleos — nucleos.io | {support_email}\n"
    )


def _build_supplier_form_html(
    cn_code: str,
    importer_name: str,
    form_url: str,
    expires_days: int,
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
        "    .body p{font-size:14px;color:#475569;line-height:1.6}\n"
        "    .items{background:#f8fafc;border-radius:6px;padding:16px 20px;margin:20px 0;"
        "font-size:14px;color:#0F172A}\n"
        "    .items li{margin:0 0 8px;padding-left:4px}\n"
        "    .items li:last-child{margin:0}\n"
        "    .btn{display:inline-block;background:#14B8A6;color:#fff;padding:13px 26px;"
        "border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;margin:20px 0}\n"
        "    .notice{font-size:12px;color:#94a3b8;margin-top:8px}\n"
        "    .footer{font-size:11px;color:#94a3b8;margin-top:24px;text-align:center;padding:0 0 24px}\n"
        "    .footer a{color:#14B8A6;text-decoration:none}\n"
        "  </style>\n"
        "</head><body>\n"
        '  <div class="wrap">\n'
        '    <div class="hdr"><h1>Nucleos &mdash; CBAM Compliance</h1></div>\n'
        '    <div class="body">\n'
        f"      <h2>Emissions data request &mdash; {cn_code}</h2>\n"
        f"      <p><strong>{importer_name}</strong> has requested your facility's emissions "
        "data for UK CBAM compliance reporting.</p>\n"
        "      <p>Please submit the following through the secure form:</p>\n"
        '      <div class="items"><ul style="margin:0;padding-left:20px">\n'
        "        <li>Specific embedded emissions (SEE) in tCO&#8322;e per tonne of product</li>\n"
        "        <li>Production route (e.g. electric arc furnace, blast furnace)</li>\n"
        "        <li>Facility name</li>\n"
        "      </ul></div>\n"
        f'      <a href="{form_url}" class="btn">Open emissions form</a>\n'
        f'      <p class="notice">This link expires in {expires_days} days and can only be used once. '
        "No account or login is required.</p>\n"
        '      <p style="font-size:14px;color:#475569;margin-top:24px">\n'
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


# ── Flow 3: importer alert when supplier submits ──────────────────────────────

async def notify_importer_supplier_submitted(
    recipient_email: str,
    case_id: str,
    cn_code: str,
    see_tco2e_per_t: float,
    production_route: str | None,
    installation_name: str | None,
    base_url: str = "",
) -> None:
    """Email the importer when their supplier submits emissions data via the form.

    Fire-and-forget — never raises. No-op when RESEND_API_KEY is absent.
    """
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    if not api_key:
        log.warning("notify_importer_supplier_submitted: RESEND_API_KEY not set — skipping")
        return

    from_email    = os.getenv("RESEND_FROM_EMAIL", "reports@nucleos.io").strip()
    support_email = os.getenv("SUPPORT_EMAIL",     "support@nucleos.io").strip()
    effective_base = base_url or _base_url()
    case_url = f"{effective_base}/cases/{case_id}" if effective_base else f"/cases/{case_id}"

    route_label   = production_route.replace("_", " ").title() if production_route else "Not specified"
    install_label = installation_name or "Not specified"

    subject = f"Supplier emissions data received — CN {cn_code}"
    text_body = (
        f"Supplier Emissions Data Received — CN {cn_code}\n\n"
        f"Your supplier has submitted emissions data for goods line CN {cn_code}.\n\n"
        f"  SEE submitted : {see_tco2e_per_t:.3f} tCO₂e/t\n"
        f"  Route         : {route_label}\n"
        f"  Installation  : {install_label}\n\n"
        f"The data has been recorded against case {case_id}.\n"
        "Review it in the Emissions tab to verify and recalculate your CBAM liability.\n\n"
        f"Open case: {case_url}\n\n"
        f"Nucleos — nucleos.io | {support_email}\n"
    )
    html_body = (
        "<!DOCTYPE html><html><head>"
        '<meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<style>"
        "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#141414;margin:0;padding:0;background:#F8F8F6}"
        ".wrap{max-width:560px;margin:32px auto;padding:0 16px}"
        ".hdr{background:#1B2F4A;padding:20px 28px;border-radius:8px 8px 0 0}"
        ".hdr p{color:#fff;font-size:13px;margin:0;letter-spacing:-0.01em;font-weight:300}"
        ".body{background:#fff;padding:28px 32px;border:0.5px solid #C4C4C0;border-top:none;border-radius:0 0 8px 8px}"
        ".body h2{margin-top:0;font-size:20px;color:#141414;font-weight:500;letter-spacing:-0.01em}"
        ".kv{background:#F8F8F6;border-radius:6px;padding:16px 24px;margin:20px 0;border:0.5px solid #C4C4C0}"
        ".kv-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid #C4C4C0}"
        ".kv-row:last-child{border-bottom:none}"
        ".kv-label{font-size:13px;font-weight:300;color:#505050}"
        ".kv-value{font-size:13px;font-weight:500;color:#141414}"
        ".btn{display:inline-block;background:#1B2F4A;color:#fff;padding:11px 24px;border-radius:6px;text-decoration:none;font-weight:500;font-size:15px;margin:20px 0}"
        ".footer{font-size:11px;color:#6E6E6A;margin-top:24px;text-align:center;padding:0 0 24px}"
        ".footer a{color:#1B2F4A;text-decoration:none}"
        "</style></head><body>"
        '<div class="wrap">'
        '<div class="hdr"><p>nucleos</p></div>'
        '<div class="body">'
        f"<h2>Supplier data received — CN {cn_code}</h2>"
        "<p style='font-size:15px;font-weight:300;color:#505050;line-height:1.6'>"
        f"Your supplier has submitted emissions data for goods line <strong>CN {cn_code}</strong>. "
        "Review it in the Emissions tab and recalculate your CBAM liability.</p>"
        '<div class="kv">'
        f'<div class="kv-row"><span class="kv-label">SEE submitted</span><span class="kv-value">{see_tco2e_per_t:.3f} tCO₂e/t</span></div>'
        f'<div class="kv-row"><span class="kv-label">Production route</span><span class="kv-value">{route_label}</span></div>'
        f'<div class="kv-row"><span class="kv-label">Installation</span><span class="kv-value">{install_label}</span></div>'
        "</div>"
        f'<a href="{case_url}" class="btn">Review in case</a>'
        "</div>"
        '<div class="footer">'
        "nucleos &mdash; "
        '<a href="https://nucleos.io">nucleos.io</a> &mdash; '
        f'<a href="mailto:{support_email}">{support_email}</a>'
        "</div></div></body></html>"
    )

    payload = {
        "from":    from_email,
        "to":      [recipient_email],
        "subject": subject,
        "text":    text_body,
        "html":    html_body,
    }

    try:
        timeout = httpx.Timeout(connect=_CONNECT_TIMEOUT, read=_READ_TIMEOUT, write=5.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if resp.status_code not in (200, 201):
            log.error(
                "notify_importer_supplier_submitted: Resend status=%s body=%.200s email=%s",
                resp.status_code, resp.text, recipient_email,
            )
        else:
            log.info("notify_importer_supplier_submitted: sent to=%s cn_code=%s", recipient_email, cn_code)
    except Exception as exc:
        log.error("notify_importer_supplier_submitted: failed email=%s: %s", recipient_email, exc)


# ── Flow 4: customer email via Resend ─────────────────────────────────────────

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
