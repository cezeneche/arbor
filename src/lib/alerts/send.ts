// Delivers an alert: Slack for every severity, email to the platform admins for
// critical and warning. Never throws: an alert must not break the cron or request
// that raised it, and one channel failing must not silence the other.
//
// Channels:
//   ops        OPS_SLACK_WEBHOOK_URL    failures, outages, drift, expiring tokens
//   enquiries  ENQUIRY_SLACK_WEBHOOK_URL  new pilot and institutional enquiries (Slack only)
import { prisma } from '@/lib/prisma'
import { EMAIL_FROM } from '@/lib/email/config'
import { getResend } from '@/lib/email/client'
import { renderEmail, renderSlack, type Alert } from './format'

export type AlertChannel = 'ops' | 'enquiries'

export interface SendDeps {
  webhooks: Record<AlertChannel, string | undefined>
  fetchImpl: typeof fetch
  recipients: () => Promise<string[]>
  sendEmail: (message: { to: string; subject: string; text: string; html: string }) => Promise<void>
}

export interface SendResult {
  slack: 'sent' | 'failed' | 'not-configured'
  emailed: number
}

const TIMEOUT_MS = 3_000

const EMAILED = new Set<Alert['severity']>(['critical', 'warning'])

function defaultDeps(): SendDeps {
  return {
    webhooks: {
      ops: process.env.OPS_SLACK_WEBHOOK_URL,
      enquiries: process.env.ENQUIRY_SLACK_WEBHOOK_URL,
    },
    fetchImpl: fetch,
    recipients: async () =>
      (await prisma.user.findMany({ where: { isPlatformAdmin: true }, select: { email: true } })).map(
        u => u.email,
      ),
    sendEmail: async message => {
      const resend = getResend()
      if (!resend) throw new Error('RESEND_API_KEY is not set')
      const { error } = await resend.emails.send({ from: EMAIL_FROM, ...message })
      if (error) throw new Error(error.message)
    },
  }
}

/** An Arbor alert with the source, environment and time filled in. */
export function arborAlert(
  fields: Omit<Alert, 'source' | 'environment' | 'at'>,
  env: Record<string, string | undefined> = process.env,
): Alert {
  return { ...fields, source: 'Arbor', environment: env.VERCEL_ENV ?? 'development', at: new Date() }
}

async function postToSlack(
  alert: Alert,
  url: string | undefined,
  deps: SendDeps,
): Promise<SendResult['slack']> {
  if (!url) return 'not-configured'
  try {
    const res = await deps.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(renderSlack(alert)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.ok) return 'sent'
    console.error(`[alerts] Slack answered ${res.status} for "${alert.title}"`)
  } catch (e) {
    console.error(`[alerts] could not reach Slack for "${alert.title}":`, e)
  }
  return 'failed'
}

async function emailAdmins(alert: Alert, deps: SendDeps): Promise<number> {
  let to: string[]
  try {
    to = await deps.recipients()
  } catch (e) {
    console.error(`[alerts] could not list platform admins for "${alert.title}":`, e)
    return 0
  }
  if (to.length === 0) console.error(`[alerts] no platform admin to email about "${alert.title}"`)

  const message = renderEmail(alert)
  const results = await Promise.allSettled(to.map(address => deps.sendEmail({ ...message, to: address })))
  for (const r of results) {
    if (r.status === 'rejected') console.error(`[alerts] email failed for "${alert.title}":`, r.reason)
  }
  return results.filter(r => r.status === 'fulfilled').length
}

/** `overrides` replaces any of the real channels, for tests. */
export async function sendAlert(
  alert: Alert,
  channel: AlertChannel,
  overrides: Partial<SendDeps> = {},
): Promise<SendResult> {
  const deps = { ...defaultDeps(), ...overrides }
  const emailed = channel === 'ops' && EMAILED.has(alert.severity)
  const [slack, sent] = await Promise.all([
    postToSlack(alert, deps.webhooks[channel], deps),
    emailed ? emailAdmins(alert, deps) : Promise.resolve(0),
  ])
  return { slack, emailed: sent }
}
