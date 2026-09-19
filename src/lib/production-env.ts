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
  'UPSTASH_REDIS_REST_URL', // rate limits; login fails closed without it
  'UPSTASH_REDIS_REST_TOKEN',
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

export function missingProductionEnv(env: Record<string, string | undefined>): string[] {
  return REQUIRED_PRODUCTION_ENV.filter(k => !env[k])
}
