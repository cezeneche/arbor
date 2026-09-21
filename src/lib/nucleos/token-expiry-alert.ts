// Emails the platform admins before the Nucleos service token expires.
//
// Nucleos accepts only tokens that carry an expiry, and Arbor cannot mint a
// replacement: it does not hold the signing key. Readiness reports the date,
// but only to whoever polls it, so without this the first sign of an expired
// token is every CBAM call failing.
import { prisma } from '@/lib/prisma'
import { EMAIL_FROM } from '@/lib/email/config'
import { escapeHtml, getResend } from '@/lib/email/client'
import type { TokenExpiry } from './service-auth'

/** Days before expiry that get a reminder. Once expired, every day does. */
const REMINDER_DAYS = new Set([14, 7, 3, 1, 0])

export interface TokenExpiryMessage {
  subject: string
  text: string
}

export function tokenExpiryAlert(expiry: TokenExpiry): TokenExpiryMessage | null {
  const on = expiry.expiresAt?.slice(0, 10)
  const renew = 'Mint a new token with cbam:read and cbam:write, set NUCLEOS_INTERNAL_TOKEN in Vercel, and redeploy.'
  if (expiry.expired) {
    return {
      subject: 'The Nucleos service token has expired',
      text: `The Nucleos service token expired on ${on}. Every CBAM call from Arbor is failing until it is replaced. ${renew}`,
    }
  }
  if (expiry.daysLeft === null || !REMINDER_DAYS.has(expiry.daysLeft)) return null
  const when = expiry.daysLeft === 0 ? 'today' : `in ${expiry.daysLeft} day${expiry.daysLeft === 1 ? '' : 's'}`
  return {
    subject: `The Nucleos service token expires ${when}`,
    text: `The Nucleos service token expires ${when}, on ${on}. After that every CBAM call from Arbor will fail. ${renew}`,
  }
}

export interface AlertDeps {
  recipients: () => Promise<string[]>
  send: (message: TokenExpiryMessage & { to: string }) => Promise<void>
}

export interface AlertResult {
  sent: number
  failed?: number
  reason?: 'no-platform-admins'
}

const defaultDeps: AlertDeps = {
  recipients: async () =>
    (await prisma.user.findMany({ where: { isPlatformAdmin: true }, select: { email: true } })).map(u => u.email),
  send: async ({ to, subject, text }) => {
    const resend = getResend()
    if (!resend) throw new Error('RESEND_API_KEY is not set')
    const { error } = await resend.emails.send({ from: EMAIL_FROM, to, subject, html: `<p>${escapeHtml(text)}</p>` })
    if (error) throw new Error(error.message)
  },
}

/** Never throws: a cron calling this must still report its own work. */
export async function sendTokenExpiryAlert(expiry: TokenExpiry, deps: AlertDeps = defaultDeps): Promise<AlertResult> {
  const message = tokenExpiryAlert(expiry)
  if (!message) return { sent: 0 }

  let to: string[]
  try {
    to = await deps.recipients()
  } catch (e) {
    console.error('[token-expiry-alert] could not list platform admins:', e)
    return { sent: 0, failed: 1 }
  }
  if (to.length === 0) {
    console.error(`[token-expiry-alert] ${message.subject}, and there is no platform admin to tell.`)
    return { sent: 0, reason: 'no-platform-admins' }
  }

  let sent = 0
  let failed = 0
  for (const address of to) {
    try {
      await deps.send({ ...message, to: address })
      sent++
    } catch (e) {
      failed++
      console.error('[token-expiry-alert] send failed:', e)
    }
  }
  return failed ? { sent, failed } : { sent }
}
