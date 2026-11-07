// Sentry's alert rules post here (an internal integration's webhook). The alert
// leaves in the house style (contract/alerts) to the ops Slack channel and, for
// critical and warning, the platform admins' email.
//
// Auth: Sentry-Hook-Signature is a hex HMAC-SHA256 with the integration's client
// secret (SENTRY_WEBHOOK_SECRET). Fails closed when the secret is unset. Sentry's
// documented example signs JSON.stringify of the parsed body rather than the raw
// bytes, so both are accepted. The signature does not cover a timestamp, so a
// captured delivery could be replayed; the worst it can do is repeat an alert.
//
// Sentry counts an answer slower than a second as a failure, so the alert is
// sent after the response.
import { NextRequest, NextResponse, after } from 'next/server'
import { verifyBodyHmac } from '@/lib/webhooks/verify-signature'
import { sentryAlert } from '@/lib/alerts/sentry'
import { sendAlert } from '@/lib/alerts/send'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const secret = process.env.SENTRY_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  const raw = await req.text()
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    body = undefined
  }

  const signature = req.headers.get('sentry-hook-signature')
  const verified =
    verifyBodyHmac(raw, signature, secret) ||
    (body !== undefined && verifyBodyHmac(JSON.stringify(body), signature, secret))
  if (!verified) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  if (body === undefined) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const alert = sentryAlert(req.headers.get('sentry-hook-resource'), body)
  if (alert) after(() => sendAlert(alert, 'ops'))
  return NextResponse.json({ ok: true })
}
