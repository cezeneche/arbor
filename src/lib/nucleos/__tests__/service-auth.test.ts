import { nucleosHeaders, serviceTokenExpiry } from '../service-auth'

// Every call to Nucleos carries the service token and a request id, so a
// failure on one side can be found in the other's logs. The token is a JWT
// minted with an expiry and nothing in Arbor refreshes it, so its remaining
// life is something readiness has to report.

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`
}

describe('nucleosHeaders', () => {
  beforeEach(() => {
    process.env.NUCLEOS_INTERNAL_TOKEN = 'service-token'
  })

  it('carries the service token and a fresh request id', () => {
    const a = nucleosHeaders()
    const b = nucleosHeaders()
    expect(a.authorization).toBe('Bearer service-token')
    expect(a['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    expect(a['x-request-id']).not.toBe(b['x-request-id'])
  })

  it('keeps extra headers and an explicit request id', () => {
    expect(nucleosHeaders({ 'content-type': 'application/json' }, 'req-1')).toEqual({
      authorization: 'Bearer service-token',
      'x-request-id': 'req-1',
      'content-type': 'application/json',
    })
  })
})

describe('serviceTokenExpiry', () => {
  const now = new Date('2026-09-19T12:00:00Z')
  const at = (iso: string) => Math.floor(Date.parse(iso) / 1000)

  it('reports the days left on a token with an expiry', () => {
    expect(serviceTokenExpiry(jwt({ exp: at('2026-10-19T12:00:00Z') }), now)).toEqual({
      expiresAt: '2026-10-19T12:00:00.000Z',
      daysLeft: 30,
      expired: false,
    })
  })

  it('reports an expired token as expired', () => {
    expect(serviceTokenExpiry(jwt({ exp: at('2026-09-18T12:00:00Z') }), now)).toMatchObject({
      expired: true,
      daysLeft: -1,
    })
  })

  it('reports no expiry for a token without one, or one that is not a JWT', () => {
    expect(serviceTokenExpiry(jwt({ sub: 'arbor' }), now)).toEqual({ expiresAt: null, daysLeft: null, expired: false })
    expect(serviceTokenExpiry('opaque-token', now)).toEqual({ expiresAt: null, daysLeft: null, expired: false })
    expect(serviceTokenExpiry('', now)).toEqual({ expiresAt: null, daysLeft: null, expired: false })
  })
})
