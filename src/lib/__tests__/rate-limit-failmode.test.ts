// Behaviour of checkRateLimit when the limiter cannot run (no Upstash config).
// With UPSTASH_* unset in the test env, getLimiter() returns null, exercising the
// fail-open / fail-closed branch without any network dependency.

describe('checkRateLimit fail mode (limiter unavailable)', () => {
  const OLD = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...OLD }
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })
  afterAll(() => {
    process.env = OLD
  })

  it('fails open by default when Upstash is not configured', async () => {
    const { checkRateLimit, RATE_LIMITS } = await import('@/lib/rate-limit')
    const res = await checkRateLimit(RATE_LIMITS.login, '1.2.3.4')
    expect(res.allowed).toBe(true)
  })

  it('fails closed when failMode is closed and Upstash is not configured', async () => {
    const { checkRateLimit, RATE_LIMITS } = await import('@/lib/rate-limit')
    const res = await checkRateLimit(RATE_LIMITS.twoFactor, 'user-1', { failMode: 'closed' })
    expect(res.allowed).toBe(false)
    expect(res.remaining).toBe(0)
  })

  it('still fails open when failMode is explicitly open', async () => {
    const { checkRateLimit, RATE_LIMITS } = await import('@/lib/rate-limit')
    const res = await checkRateLimit(RATE_LIMITS.login, '1.2.3.4', { failMode: 'open' })
    expect(res.allowed).toBe(true)
  })
})
