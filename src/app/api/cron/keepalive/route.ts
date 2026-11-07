// Free-tier keep-alive for the two managed services that reclaim what looks
// idle: the Supabase database and the Upstash Redis behind the rate limiter.
// Both have been lost that way. This scheduled worker touches each one so they
// register regular activity, and reports a failure rather than a cheerful 200 —
// an unreachable Redis fails the login gate closed, taking sign-in down with it.
// Reads and writes nothing of substance.
//
// It is also the daily check on the Nucleos service token, which Arbor cannot
// renew itself: the platform admins are emailed as its expiry approaches.
//
// Auth and the Sentry cron monitor: src/lib/cron.ts. Scheduled in vercel.json.
import { cronRoute } from '@/lib/cron'
import { prisma } from '@/lib/prisma'
import { rateLimiterHealth } from '@/lib/rate-limit'
import { monitoredServiceToken, serviceTokenExpiry } from '@/lib/nucleos/service-auth'
import { sendTokenExpiryAlert } from '@/lib/nucleos/token-expiry-alert'
import { arborAlert, sendAlert } from '@/lib/alerts/send'
import { keepaliveAlert } from '@/lib/monitoring/keepalive-alert'

export const dynamic = 'force-dynamic'

async function run() {
  // SELECT 1 opens a real connection to Postgres, and PING one to Upstash —
  // enough activity to reset either inactivity timer, touching no table.
  let database = 'ok'
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (e) {
    console.error('[cron/keepalive] database ping failed:', e)
    database = 'The database did not answer.'
  }

  const limiter = await rateLimiterHealth()
  if (!limiter.ok) console.error('[cron/keepalive] rate limiter unreachable:', limiter.detail)

  const token = serviceTokenExpiry(monitoredServiceToken())
  const alert = await sendTokenExpiryAlert(token)

  const ok = database === 'ok' && limiter.ok
  const down = keepaliveAlert(database === 'ok', limiter.ok)
  if (down) await sendAlert(arborAlert(down), 'ops')
  return Response.json(
    {
      status: ok ? 'ok' : 'error',
      database,
      rateLimiter: limiter.ok ? 'ok' : (limiter.detail ?? 'unreachable'),
      serviceToken: { expiresAt: token.expiresAt, daysLeft: token.daysLeft, alertsSent: alert.sent },
      pingedAt: new Date().toISOString(),
    },
    { status: ok ? 200 : 500 },
  )
}

export const GET = cronRoute('/api/cron/keepalive', run)
