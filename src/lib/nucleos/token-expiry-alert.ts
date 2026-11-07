// Warns the platform admins, in Slack and by email, before the Nucleos service token expires.
//
// Nucleos accepts only tokens that carry an expiry, and Arbor cannot mint a
// replacement: it does not hold the signing key. Readiness reports the date,
// but only to whoever polls it, so without this the first sign of an expired
// token is every CBAM call failing.
import { arborAlert, sendAlert, type SendDeps } from '@/lib/alerts/send'
import type { Alert } from '@/lib/alerts/format'
import type { TokenExpiry } from './service-auth'

/** Days before expiry that get a reminder. Once expired, every day does. */
const REMINDER_DAYS = new Set([14, 7, 3, 1, 0])

const RENEW =
  'Mint a new token with cbam:read, cbam:write and narrative:run, set NUCLEOS_INTERNAL_TOKEN in Vercel, and redeploy. ' +
  'Or end renewals: set NUCLEOS_OIDC_AUDIENCE so Arbor uses its Vercel identity (docs/INTEGRATION-ROLLOUT.md).'

export function tokenExpiryAlert(expiry: TokenExpiry): Omit<Alert, 'source' | 'environment' | 'at'> | null {
  const on = expiry.expiresAt?.slice(0, 10) ?? 'unknown'
  if (expiry.expired) {
    return {
      severity: 'critical',
      title: 'The Nucleos service token has expired',
      summary: 'Every CBAM call from Arbor is failing until it is replaced.',
      facts: [{ label: 'Expired on', value: on }],
      action: RENEW,
    }
  }
  if (expiry.daysLeft === null || !REMINDER_DAYS.has(expiry.daysLeft)) return null
  const when =
    expiry.daysLeft === 0 ? 'today' : `in ${expiry.daysLeft} day${expiry.daysLeft === 1 ? '' : 's'}`
  return {
    severity: 'warning',
    title: `The Nucleos service token expires ${when}`,
    summary: 'After that every CBAM call from Arbor will fail.',
    facts: [{ label: 'Expires on', value: on }],
    action: RENEW,
  }
}

export interface AlertResult {
  /** Emails delivered. */
  sent: number
}

/** Never throws: a cron calling this must still report its own work. */
export async function sendTokenExpiryAlert(
  expiry: TokenExpiry,
  overrides: Partial<SendDeps> = {},
): Promise<AlertResult> {
  const alert = tokenExpiryAlert(expiry)
  if (!alert) return { sent: 0 }
  const { emailed } = await sendAlert(arborAlert(alert), 'ops', overrides)
  return { sent: emailed }
}
