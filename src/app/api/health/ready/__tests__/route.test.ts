import { NextRequest } from 'next/server'

// E4: readiness gives up on a database that does not answer. Without a limit a
// hung connection hung the check itself, so an uptime monitor saw a timeout,
// not the 503 that says what is wrong, and Arbor's own check of Nucleos waited
// with it.

const queryRaw = jest.fn()
jest.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: (...a: unknown[]) => queryRaw(...a) } }))
jest.mock('@/lib/production-env', () => ({ missingProductionEnv: () => [] }))
jest.mock('@/lib/rate-limit', () => ({ rateLimiterHealth: async () => ({ ok: true }) }))
jest.mock('@/lib/nucleos/readiness-probe', () => ({ probeNucleos: async () => ({ ok: true }) }))
jest.mock('@/lib/nucleos/service-auth', () => ({
  monitoredServiceToken: () => null,
  serviceTokenExpiry: () => ({ ok: true }),
}))
jest.mock('@/lib/cron', () => ({ isCronRequest: () => true }))
import { GET } from '../route'

const request = () => new NextRequest('http://localhost/api/health/ready')

afterEach(() => jest.useRealTimers())

it('reports not ready when the database does not answer in time', async () => {
  jest.useFakeTimers()
  queryRaw.mockReturnValue(new Promise(() => {}))
  const pending = GET(request())
  await jest.advanceTimersByTimeAsync(3000)
  const res = await pending
  expect(res.status).toBe(503)
  expect(JSON.stringify(await res.json())).toContain('The database did not answer')
})

it('reports ready when the database answers', async () => {
  queryRaw.mockResolvedValue([{ '?column?': 1 }])
  expect((await GET(request())).status).toBe(200)
})
