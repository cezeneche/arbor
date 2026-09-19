import { REQUIRED_PRODUCTION_ENV, missingProductionEnv } from '../production-env'

// A production build without these deploys an app that fails on first use —
// login fails closed without Redis, every CBAM document errors without Nucleos,
// nothing extracts without Inngest. Refusing the build is loud; failing at
// request time is invisible until a customer finds it.
describe('missingProductionEnv', () => {
  // Redis is not in the list: either pair of names satisfies it, so it is
  // checked separately.
  const complete: Record<string, string> = {
    ...Object.fromEntries(REQUIRED_PRODUCTION_ENV.map(k => [k, 'set'])),
    UPSTASH_REDIS_REST_URL: 'https://u.example',
    UPSTASH_REDIS_REST_TOKEN: 'u-token',
  }

  it('passes when everything is set', () => {
    expect(missingProductionEnv(complete)).toEqual([])
  })

  it('names what is missing, including an empty value', () => {
    expect(missingProductionEnv({ ...complete, NUCLEOS_URL: undefined })).toEqual(['NUCLEOS_URL'])
  })

  it('accepts either name for the Redis credentials, and reports one entry when neither is set', () => {
    const noRedis = { ...complete, UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' }
    expect(missingProductionEnv(noRedis)).toEqual(['UPSTASH_REDIS_REST_URL / KV_REST_API_URL (+ token)'])
    expect(
      missingProductionEnv({ ...noRedis, KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 'kv-token' }),
    ).toEqual([])
  })

  it('covers every service a request depends on', () => {
    for (const name of [
      'DATABASE_URL', 'AUTH_SECRET', 'AUDIT_CHAIN_SECRET',
      'NUCLEOS_URL', 'NUCLEOS_INTERNAL_TOKEN', 'INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY',
      'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'CRON_SECRET',
    ]) {
      expect(REQUIRED_PRODUCTION_ENV).toContain(name)
    }
  })
})
