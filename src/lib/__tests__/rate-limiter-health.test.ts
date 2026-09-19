// A limiter that cannot reach Upstash takes sign-in down with it: the login gate
// fails closed, so every password is rejected as if it were wrong. The health
// probe exists so /api/health/ready says that plainly instead of the site
// looking up and refusing everyone.

describe('rateLimiterHealth', () => {
  const OLD = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...OLD }
  })
  afterAll(() => {
    process.env = OLD
  })

  it('is not ok when Upstash is not configured', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    const { rateLimiterHealth } = await import('@/lib/rate-limit')

    const health = await rateLimiterHealth()
    expect(health.ok).toBe(false)
    expect(health.detail).toMatch(/sign in/i)
  })

  it('is not ok when the host is configured but does not answer', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://gone.example.invalid'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
    jest.doMock('@upstash/redis', () => ({
      Redis: class {
        ping() {
          return Promise.reject(new Error('getaddrinfo ENOTFOUND gone.example.invalid'))
        }
      },
    }))
    const { rateLimiterHealth } = await import('@/lib/rate-limit')

    const health = await rateLimiterHealth()
    expect(health.ok).toBe(false)
    expect(health.detail).toMatch(/did not answer/i)
  })

  it('is ok when Upstash answers', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.invalid'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
    jest.doMock('@upstash/redis', () => ({
      Redis: class {
        ping() {
          return Promise.resolve('PONG')
        }
      },
    }))
    const { rateLimiterHealth } = await import('@/lib/rate-limit')

    expect(await rateLimiterHealth()).toEqual({ ok: true })
  })
})
