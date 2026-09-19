// Free-tier keep-alive for the two managed services that reclaim what looks
// idle: the Supabase database and the Upstash Redis behind the rate limiter.
// Both have been lost that way. This scheduled worker touches each one so they
// register regular activity, and reports a failure rather than a cheerful 200 —
// an unreachable Redis fails the login gate closed, taking sign-in down with it.
// Reads and writes nothing of substance.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Fail closed if the
// secret is unset. Scheduled in vercel.json.
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rateLimiterHealth } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

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

  const ok = database === 'ok' && limiter.ok
  return Response.json(
    {
      status: ok ? 'ok' : 'error',
      database,
      rateLimiter: limiter.ok ? 'ok' : (limiter.detail ?? 'unreachable'),
      pingedAt: new Date().toISOString(),
    },
    { status: ok ? 200 : 500 },
  )
}
