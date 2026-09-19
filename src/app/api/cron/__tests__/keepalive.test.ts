/**
 * The keep-alive cron.
 *
 * Two managed services sit behind free tiers that reclaim what looks idle: the
 * Postgres database and the Upstash Redis the rate limiter uses. Both have been
 * lost that way, and a missing Redis takes sign-in down with it, so the job
 * touches both and reports either failure rather than a cheerful 200.
 */

const queryRaw = jest.fn(async () => [{ '?column?': 1 }])
jest.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: (...a: unknown[]) => queryRaw(...(a as [])) } }))

const rateLimiterHealth = jest.fn(async () => ({ ok: true }) as { ok: boolean; detail?: string })
jest.mock('@/lib/rate-limit', () => ({ rateLimiterHealth: () => rateLimiterHealth() }))

import { NextRequest } from 'next/server'

import { GET } from '../keepalive/route'

const request = (auth?: string) =>
  new NextRequest('http://arbor.test/api/cron/keepalive', {
    headers: auth ? { authorization: auth } : {},
  })

describe('GET /api/cron/keepalive', () => {
  const OLD = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...OLD, CRON_SECRET: 'secret' }
  })
  afterAll(() => {
    process.env = OLD
  })

  it('refuses a caller without the cron secret', async () => {
    expect((await GET(request())).status).toBe(401)
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it('touches both the database and Redis', async () => {
    const res = await GET(request('Bearer secret'))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', database: 'ok', rateLimiter: 'ok' })
    expect(queryRaw).toHaveBeenCalled()
    expect(rateLimiterHealth).toHaveBeenCalled()
  })

  it('reports an unreachable Redis even though the database answered', async () => {
    rateLimiterHealth.mockResolvedValueOnce({ ok: false, detail: 'Upstash did not answer, so nobody can sign in.' })

    const res = await GET(request('Bearer secret'))

    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({
      status: 'error',
      database: 'ok',
      rateLimiter: 'Upstash did not answer, so nobody can sign in.',
    })
  })
})
