import {
  getSupplierFormContext,
  submitSupplierForm,
  SupplierTokenInvalidError,
} from '../supplier-form-client'

// The one surface a non-Arbor user sees. They have no account and no reason to
// trust an unexplained error, so every failure must say something actionable —
// and nothing may leak the token or an upstream message.

const CONTEXT = {
  cn_code: '72071111',
  sector: 'iron_steel',
  description: null,
  installation_name: null,
  origin_country: 'TR',
  importer_name: 'Northern Steel Stockholders Ltd',
  reporting_year: 2027,
  production_routes: [{ key: 'BF_BOF', label: 'Blast furnace' }],
  expires_at: '2027-01-01T00:00:00Z',
}

function res(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

describe('getSupplierFormContext', () => {
  const ORIGINAL = { ...process.env }
  beforeEach(() => {
    process.env.NUCLEOS_URL = 'https://nucleos.test'
    process.env.NUCLEOS_INTERNAL_TOKEN = 'token'
  })
  afterEach(() => { process.env = { ...ORIGINAL } })

  it('returns the context for a live token', async () => {
    const f = jest.fn().mockResolvedValue(res(200, CONTEXT))
    expect((await getSupplierFormContext('tok', f as never)).cn_code).toBe('72071111')
  })

  it('sends no bearer token — the URL token is the credential', async () => {
    const f = jest.fn().mockResolvedValue(res(200, CONTEXT))
    await getSupplierFormContext('tok', f as never)
    const init = f.mock.calls[0][1] ?? {}
    expect(JSON.stringify(init)).not.toContain('authorization')
  })

  it('explains an expired or used link in plain English', async () => {
    for (const status of [404, 410, 403]) {
      const f = jest.fn().mockResolvedValue(res(status))
      await expect(getSupplierFormContext('tok', f as never)).rejects.toBeInstanceOf(
        SupplierTokenInvalidError,
      )
    }
  })

  it('tells the supplier what to do about a dead link', async () => {
    const f = jest.fn().mockResolvedValue(res(410))
    await expect(getSupplierFormContext('tok', f as never)).rejects.toThrow(
      /ask the company that sent it/i,
    )
  })

  it('never puts the token in an error', async () => {
    // These pages are opened from an email that may be forwarded.
    const f = jest.fn().mockResolvedValue(res(410))
    await expect(getSupplierFormContext('secret-token-value', f as never)).rejects.not.toThrow(
      /secret-token-value/,
    )
  })
})

describe('submitSupplierForm', () => {
  const ORIGINAL = { ...process.env }
  beforeEach(() => {
    process.env.NUCLEOS_URL = 'https://nucleos.test'
    process.env.NUCLEOS_INTERNAL_TOKEN = 'token'
  })
  afterEach(() => { process.env = { ...ORIGINAL } })

  it('posts the three fields', async () => {
    const f = jest.fn().mockResolvedValue(res(200, { status: 'received' }))
    await submitSupplierForm('tok', { see_tco2e_per_t: 1.8, production_route: 'BF_BOF' }, f as never)
    const body = JSON.parse(f.mock.calls[0][1].body)
    expect(body.see_tco2e_per_t).toBe(1.8)
    expect(body.production_route).toBe('BF_BOF')
  })

  it('never surfaces the upstream body', async () => {
    // It can name internal tables, and is read by someone outside the org.
    const f = jest.fn().mockResolvedValue(res(500, { detail: 'relation cbam.x does not exist' }))
    await expect(
      submitSupplierForm('tok', { see_tco2e_per_t: 1.8, production_route: 'BF_BOF' }, f as never),
    ).rejects.not.toThrow(/relation/)
  })

  it('treats a dead token as a dead token, not a server fault', async () => {
    const f = jest.fn().mockResolvedValue(res(410))
    await expect(
      submitSupplierForm('tok', { see_tco2e_per_t: 1.8, production_route: 'BF_BOF' }, f as never),
    ).rejects.toBeInstanceOf(SupplierTokenInvalidError)
  })
})
