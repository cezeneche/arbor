const getVercelOidcToken = jest.fn()
jest.mock('@vercel/oidc', () => ({ getVercelOidcToken: (...a: unknown[]) => getVercelOidcToken(...a) }))

import {
  monitoredServiceToken,
  nucleosAuthMode,
  nucleosHeaders,
  serviceTokenExpiry,
} from '../service-auth'
import { NucleosUnavailableError } from '../extraction-client'

// Every call to Nucleos carries a credential and a request id, so a failure on
// one side can be found in the other's logs.
//
// The credential is Arbor's Vercel OIDC token, exchanged for Nucleos's
// audience, whenever NUCLEOS_OIDC_AUDIENCE is set: short-lived and refreshed
// by Vercel, so there is nothing to renew (to-do C3). The year-long
// NUCLEOS_INTERNAL_TOKEN is the fallback, and while it is the credential in
// use its remaining life is something readiness has to report.

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`
}

const ORIGINAL = { ...process.env }
beforeEach(() => {
  process.env = { ...ORIGINAL }
  delete process.env.NUCLEOS_OIDC_AUDIENCE
  process.env.NUCLEOS_INTERNAL_TOKEN = 'service-token'
  getVercelOidcToken.mockReset()
})
afterAll(() => {
  process.env = ORIGINAL
})

describe('nucleosAuthMode', () => {
  it('prefers the OIDC identity, then the static token', () => {
    expect(nucleosAuthMode({ NUCLEOS_OIDC_AUDIENCE: 'https://n', NUCLEOS_INTERNAL_TOKEN: 't' })).toBe('oidc')
    expect(nucleosAuthMode({ NUCLEOS_INTERNAL_TOKEN: 't' })).toBe('token')
    expect(nucleosAuthMode({})).toBe('none')
  })
})

describe('nucleosHeaders with the static token', () => {
  it('carries the service token and a fresh request id', async () => {
    const a = await nucleosHeaders()
    const b = await nucleosHeaders()
    expect(a.authorization).toBe('Bearer service-token')
    expect(a['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    expect(a['x-request-id']).not.toBe(b['x-request-id'])
    expect(getVercelOidcToken).not.toHaveBeenCalled()
  })

  it('keeps extra headers and an explicit request id', async () => {
    expect(await nucleosHeaders({ 'content-type': 'application/json' }, 'req-1')).toEqual({
      authorization: 'Bearer service-token',
      'x-request-id': 'req-1',
      'content-type': 'application/json',
    })
  })
})

describe('nucleosHeaders with the OIDC identity', () => {
  beforeEach(() => {
    process.env.NUCLEOS_OIDC_AUDIENCE = 'https://nucleos.test'
  })

  it('sends the Vercel token exchanged for Nucleos\'s audience', async () => {
    getVercelOidcToken.mockResolvedValue('oidc-token')
    const h = await nucleosHeaders()
    expect(h.authorization).toBe('Bearer oidc-token')
    expect(getVercelOidcToken).toHaveBeenCalledWith({ audience: 'https://nucleos.test' })
  })

  it('falls back to the static token when the exchange fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    getVercelOidcToken.mockRejectedValue(new Error('no x-vercel-oidc-token header'))
    expect((await nucleosHeaders()).authorization).toBe('Bearer service-token')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no x-vercel-oidc-token header'))
    warn.mockRestore()
  })

  it('refuses when the exchange fails and there is no static token', async () => {
    delete process.env.NUCLEOS_INTERNAL_TOKEN
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    getVercelOidcToken.mockRejectedValue(new Error('exchange refused'))
    await expect(nucleosHeaders()).rejects.toBeInstanceOf(NucleosUnavailableError)
  })
})

describe('nucleosHeaders with no credential', () => {
  it('refuses', async () => {
    delete process.env.NUCLEOS_INTERNAL_TOKEN
    await expect(nucleosHeaders()).rejects.toBeInstanceOf(NucleosUnavailableError)
  })
})

describe('monitoredServiceToken', () => {
  it('is the static token only while it is the credential in use', () => {
    expect(monitoredServiceToken({ NUCLEOS_INTERNAL_TOKEN: 't' })).toBe('t')
    // A fallback that is not in use must not raise renewal alarms.
    expect(monitoredServiceToken({ NUCLEOS_OIDC_AUDIENCE: 'https://n', NUCLEOS_INTERNAL_TOKEN: 't' })).toBe('')
    expect(monitoredServiceToken({})).toBe('')
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
