// The wrapper every scheduled route runs inside: the CRON_SECRET check, and a
// Sentry cron monitor that notices a run that failed or never happened.
//
// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; the check fails closed
// when the secret is unset and compares in constant time. Only an authorised run
// checks in, so a stray caller cannot mask a missed one. The schedule comes from
// vercel.json, so the monitor expects runs exactly when Vercel makes them.
import { createHash, timingSafeEqual } from 'node:crypto'
import * as Sentry from '@sentry/nextjs'
import type { NextRequest } from 'next/server'
import vercelConfig from '../../vercel.json'

export function isCronRequest(authorization: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!secret || !authorization) return false
  // Hashing first gives equal-length inputs, so the comparison leaks no length.
  const digest = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))
}

export function cronSchedule(path: string): string | null {
  return vercelConfig.crons.find(c => c.path === path)?.schedule ?? null
}

export interface CronDeps {
  secret?: string
  captureCheckIn: typeof Sentry.captureCheckIn
  flush: (timeoutMs: number) => Promise<boolean>
}

const defaultDeps = (): CronDeps => ({
  secret: process.env.CRON_SECRET,
  captureCheckIn: Sentry.captureCheckIn,
  flush: Sentry.flush,
})

export function cronRoute(
  path: string,
  handler: (req: NextRequest) => Promise<Response>,
  overrides?: CronDeps,
): (req: NextRequest) => Promise<Response> {
  return async req => {
    const deps = overrides ?? defaultDeps()
    if (!isCronRequest(req.headers.get('authorization'), deps.secret)) {
      return new Response('Unauthorized', { status: 401 })
    }
    const schedule = cronSchedule(path)
    if (!schedule) return handler(req)

    const monitorSlug = `cron-${path.split('/').pop()}`
    const checkInId = deps.captureCheckIn(
      { monitorSlug, status: 'in_progress' },
      {
        schedule: { type: 'crontab', value: schedule },
        timezone: 'Etc/UTC',
        checkinMargin: 10,
        maxRuntime: 10,
        failureIssueThreshold: 1,
        recoveryThreshold: 1,
      },
    )
    const started = Date.now()
    const finish = async (status: 'ok' | 'error') => {
      deps.captureCheckIn({ monitorSlug, status, checkInId, duration: (Date.now() - started) / 1000 })
      // A serverless function can be frozen once it returns; send before it is.
      await deps.flush(2_000)
    }

    try {
      const res = await handler(req)
      await finish(res.status >= 500 ? 'error' : 'ok')
      return res
    } catch (e) {
      await finish('error')
      throw e
    }
  }
}
