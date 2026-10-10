// Announces a newly saved pilot or institutional enquiry in Slack, so it is not
// left unseen in the database. Only the organisation, the kind of enquiry and a
// link to the review page are sent; contact details and messages stay in Arbor.
// Does nothing until ENQUIRY_SLACK_WEBHOOK_URL is set, and never throws: a failed
// alert must not fail the enquiry it announces.

export interface EnquiryAlert {
  kind: 'pilot' | 'institutional'
  orgName: string
  /** Audience or interest area, shown in brackets when present. */
  detail: string
}

const TIMEOUT_MS = 3_000

export function enquiryAlertText(alert: EnquiryAlert, appUrl: string): string {
  const detail = alert.detail ? ` (${alert.detail})` : ''
  return `New ${alert.kind} enquiry from ${alert.orgName}${detail}. Review it: ${appUrl}/admin/enquiries`
}

export async function sendEnquiryAlert(
  alert: EnquiryAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const webhook = process.env.ENQUIRY_SLACK_WEBHOOK_URL
  if (!webhook) return false
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  try {
    const res = await fetchImpl(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: enquiryAlertText(alert, appUrl) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) console.error(`[enquiry-alert] Slack answered ${res.status}`)
    return res.ok
  } catch (err) {
    console.error('[enquiry-alert] could not reach Slack:', err)
    return false
  }
}
