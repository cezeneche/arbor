import { calculateDeclaration, NucleosCalculationError } from '../calculate-client'
import { NucleosUnavailableError } from '../extraction-client'
import type { CalculationResult, DeclarationPayload } from '../contract'

const PAYLOAD: DeclarationPayload = {
  case_reference: 'case-1',
  entity_id: 'ent-1',
  jurisdiction: 'UK',
  reporting_year: 2027,
  reporting_quarter: 1,
  lines: [
    {
      line_id: 'gl-1',
      cn_code: '72081000',
      net_mass_kg: 24000,
      provenance_tier: 'VERIFIED',
    },
  ],
}

function okResult(overrides: Partial<CalculationResult> = {}): CalculationResult {
  return {
    case_reference: 'case-1',
    jurisdiction: 'UK',
    reporting_year: 2027,
    lines: [
      {
        line_id: 'gl-1',
        emissions_method: 'ACTUAL',
        provenance_tier: 'VERIFIED',
        direct_kgco2e: 43200,
        indirect_kgco2e: 0,
        embedded_tco2e: 43.2,
      },
    ],
    total_embedded_tco2e: 43.2,
    engine: { engine_version: '2.4.0' },
    ...overrides,
  } as CalculationResult
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('calculateDeclaration', () => {
  const ORIGINAL = { ...process.env }

  beforeEach(() => {
    process.env.NUCLEOS_URL = 'https://nucleos.test'
    process.env.NUCLEOS_INTERNAL_TOKEN = 'token'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  it('posts to the internal calculate endpoint with the token', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(okResult()))
    await calculateDeclaration(PAYLOAD, { fetchImpl: fetchImpl as never })

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://nucleos.test/api/internal/calculate')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer token')
    expect(JSON.parse(init.body).case_reference).toBe('case-1')
  })

  it('returns the parsed result on success', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(okResult()))
    const out = await calculateDeclaration(PAYLOAD, { fetchImpl: fetchImpl as never })
    expect(out.lines[0].embedded_tco2e).toBe(43.2)
  })

  it('surfaces a non-2xx as a calculation error carrying the status', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ detail: 'bad line' }, 422))
    await expect(
      calculateDeclaration(PAYLOAD, { fetchImpl: fetchImpl as never }),
    ).rejects.toBeInstanceOf(NucleosCalculationError)
  })

  // A total built from part of a declaration renders exactly like a complete
  // one. The endpoint fails closed on this; so does the client.
  it('refuses a result with fewer lines than were sent', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(okResult({ lines: [] })))
    await expect(
      calculateDeclaration(PAYLOAD, { fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/0 calculated lines for 1 sent/)
  })

  it('refuses a result for a different case', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(okResult({ case_reference: 'case-other' })))
    await expect(
      calculateDeclaration(PAYLOAD, { fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/case-other/)
  })

  it('refuses a result with no engine version, which could not be reproduced', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(okResult({ engine: {} as never })))
    await expect(
      calculateDeclaration(PAYLOAD, { fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/engine version/)
  })

  it('reports a timeout as unavailable rather than as a wrong answer', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const fetchImpl = jest.fn().mockRejectedValue(abort)
    await expect(
      calculateDeclaration(PAYLOAD, { fetchImpl: fetchImpl as never, timeoutMs: 5 }),
    ).rejects.toBeInstanceOf(NucleosUnavailableError)
  })

  it('refuses to call at all when Nucleos is not configured', async () => {
    delete process.env.NUCLEOS_INTERNAL_TOKEN
    const fetchImpl = jest.fn()
    await expect(
      calculateDeclaration(PAYLOAD, { fetchImpl: fetchImpl as never }),
    ).rejects.toBeInstanceOf(NucleosUnavailableError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
