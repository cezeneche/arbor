import { redisCredentials } from './redis-credentials'

// What a production deployment cannot run without. Checked by the build
// (next.config.ts) and reported by /api/health/ready.
//
// Each one is here because its absence fails a real request rather than
// degrading it: an unset NEXT_PUBLIC_APP_URL mints localhost links in customer
// email, login fails closed without Redis, every CBAM document errors without
// Nucleos, nothing is extracted without Inngest.
export const REQUIRED_PRODUCTION_ENV = [
  'NEXT_PUBLIC_APP_URL', // canonical external origin for all minted links
  'DATABASE_URL',
  'AUTH_SECRET', // session signing
  'AUDIT_CHAIN_SECRET', // HMAC audit chain
  'TOTP_ENCRYPTION_KEY', // 2FA secret encryption
  'NUCLEOS_URL', // CBAM extraction, cases, returns
  'NUCLEOS_INTERNAL_TOKEN',
  'INNGEST_EVENT_KEY', // document extraction runs as an Inngest function
  'INNGEST_SIGNING_KEY',
  'SUPABASE_URL', // document storage
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY', // password reset, requests, notifications
  'CRON_SECRET', // scheduled jobs, including the CBAM handoff sweep
  'ANTHROPIC_API_KEY', // document extraction
] as const

/** Named apart from the list because either pair of names will do. */
export const REDIS_CREDENTIALS_LABEL = 'UPSTASH_REDIS_REST_URL / KV_REST_API_URL (+ token)'

export function missingProductionEnv(env: Record<string, string | undefined>): string[] {
  const missing: string[] = REQUIRED_PRODUCTION_ENV.filter(k => !env[k])
  // Rate limits; login fails closed without them.
  if (!redisCredentials(env)) missing.push(REDIS_CREDENTIALS_LABEL)
  return missing
}
