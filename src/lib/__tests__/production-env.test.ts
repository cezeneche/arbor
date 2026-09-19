import { REQUIRED_PRODUCTION_ENV, missingProductionEnv } from '../production-env'

// A production build without these deploys an app that fails on first use —
// login fails closed without Redis, every CBAM document errors without Nucleos,
// nothing extracts without Inngest. Refusing the build is loud; failing at
// request time is invisible until a customer finds it.
describe('missingProductionEnv', () => {
  const complete = Object.fromEntries(REQUIRED_PRODUCTION_ENV.map(k => [k, 'set']))

  it('passes when everything is set', () => {
    expect(missingProductionEnv(complete)).toEqual([])
  })

  it('names what is missing, including an empty value', () => {
    expect(missingProductionEnv({ ...complete, NUCLEOS_URL: undefined, UPSTASH_REDIS_REST_URL: '' })).toEqual([
      'UPSTASH_REDIS_REST_URL',
      'NUCLEOS_URL',
    ])
  })

  it('covers every service a request depends on', () => {
    for (const name of [
      'DATABASE_URL', 'AUTH_SECRET', 'AUDIT_CHAIN_SECRET', 'UPSTASH_REDIS_REST_URL',
      'NUCLEOS_URL', 'NUCLEOS_INTERNAL_TOKEN', 'INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY',
      'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'CRON_SECRET',
    ]) {
      expect(REQUIRED_PRODUCTION_ENV).toContain(name)
    }
  })
})
