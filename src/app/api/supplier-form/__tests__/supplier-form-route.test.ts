/**
 * The public supplier form submission.
 *
 * Reachable without an account — the URL token is the credential and Nucleos
 * validates it. Being public, it is rate limited per IP and refuses input that
 * is obviously unusable before anything is forwarded.
 */

let allowed = true
jest.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { supplierForm: { prefix: 'supplier-form', limit: 20, window: '10 m' } },
  checkRateLimit: jest.fn(async () => ({ allowed, remaining: allowed ? 1 : 0 })),
}))

const submitSupplierForm = jest.fn(async () => undefined)
jest.mock('@/lib/nucleos/supplier-form-client', () => ({
  submitSupplierForm: (...args: unknown[]) => submitSupplierForm(...(args as [])),
  SupplierTokenInvalidError: class extends Error {},
}))

import { POST } from '../[token]/route'

const params = (token: string) => ({ params: Promise.resolve({ token }) })
const post = (body: unknown) =>
  new Request('http://arbor.test/api/supplier-form/t', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  })

const valid = { see_tco2e_per_t: 1.9, production_route: 'BF-BOF', installation_name: 'Plant 1' }

beforeEach(() => {
  allowed = true
  jest.clearAllMocks()
})

describe('POST /api/supplier-form/[token]', () => {
  it('forwards a valid submission', async () => {
    const res = await POST(post(valid), params('tok-123'))
    expect(res.status).toBe(200)
    expect(submitSupplierForm).toHaveBeenCalledWith('tok-123', {
      see_tco2e_per_t: 1.9,
      production_route: 'BF-BOF',
      installation_name: 'Plant 1',
    })
  })

  it('refuses a caller over the rate limit before touching Nucleos', async () => {
    allowed = false
    const res = await POST(post(valid), params('tok-123'))
    expect(res.status).toBe(429)
    expect(submitSupplierForm).not.toHaveBeenCalled()
  })

  it('refuses an absurd emissions intensity', async () => {
    const res = await POST(post({ ...valid, see_tco2e_per_t: 5_000_000 }), params('tok-123'))
    expect(res.status).toBe(400)
    expect(submitSupplierForm).not.toHaveBeenCalled()
  })

  it('refuses oversized text fields', async () => {
    const res = await POST(post({ ...valid, installation_name: 'x'.repeat(5000) }), params('tok-123'))
    expect(res.status).toBe(400)
    expect(submitSupplierForm).not.toHaveBeenCalled()
  })

  it('refuses a token that cannot be one', async () => {
    const res = await POST(post(valid), params('t'.repeat(1000)))
    expect(res.status).toBe(404)
    expect(submitSupplierForm).not.toHaveBeenCalled()
  })
})
