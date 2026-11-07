// The alert the keep-alive cron raises when a managed service stops answering.
// Both the database and the Upstash Redis have vanished on free tiers before,
// and each was found by a user (see docs/production-readiness.md, E2).
import type { Alert } from '@/lib/alerts/format'

/** One critical alert naming whatever did not answer; null when both did. */
export function keepaliveAlert(
  databaseUp: boolean,
  redisUp: boolean,
): Omit<Alert, 'source' | 'environment' | 'at'> | null {
  if (databaseUp && redisUp) return null
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const link = appUrl ? { label: 'Open readiness', url: `${appUrl}/api/health/ready` } : undefined
  const common = { severity: 'critical' as const, link, ref: 'cron/keepalive' }
  if (!databaseUp && !redisUp) {
    return {
      ...common,
      title: 'The database and Redis are both not answering',
      summary: 'Arbor cannot read or write records, and nobody can sign in.',
      action: 'Check that the Supabase project and the Upstash database still exist and are not paused.',
    }
  }
  if (!databaseUp) {
    return {
      ...common,
      title: 'The database is not answering',
      summary: 'Arbor cannot read or write records until it is back.',
      action: 'Check that the Supabase project still exists and is not paused.',
    }
  }
  return {
    ...common,
    title: 'Sign-in is failing: Redis is not answering',
    summary: 'The rate limiter fails closed, so every sign-in is refused with "Invalid email or password".',
    action:
      'Check that the Upstash database still exists in Vercel → Storage, and that KV_REST_API_URL points at it.',
  }
}
