// Announces a newly saved pilot or institutional enquiry in Slack, so it is not
// left unseen in the database. Only the organisation, the kind of enquiry and a
// link to the review page are sent; contact details and messages stay in Arbor.
// Does nothing until ENQUIRY_SLACK_WEBHOOK_URL is set, and never throws: a failed
// alert must not fail the enquiry it announces.
import { arborAlert, sendAlert } from '@/lib/alerts/send'
import type { Alert } from '@/lib/alerts/format'

export interface EnquiryAlert {
  kind: 'pilot' | 'institutional'
  orgName: string
  /** Audience or interest area, shown as a fact when present. */
  detail: string
}

export function enquiryAlert(
  alert: EnquiryAlert,
  appUrl: string,
): Omit<Alert, 'source' | 'environment' | 'at'> {
  return {
    severity: 'info',
    title: `New ${alert.kind} enquiry from ${alert.orgName}`,
    summary: 'Their contact details and message are on the review page.',
    facts: alert.detail ? [{ label: 'Details', value: alert.detail }] : [],
    link: { label: 'Review the enquiry', url: `${appUrl}/admin/enquiries` },
  }
}

export async function sendEnquiryAlert(
  alert: EnquiryAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const result = await sendAlert(arborAlert(enquiryAlert(alert, appUrl)), 'enquiries', { fetchImpl })
  return result.slack === 'sent'
}
