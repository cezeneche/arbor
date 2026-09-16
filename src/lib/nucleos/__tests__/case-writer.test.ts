import { createCbamCase } from '../case-writer'
import { NucleosUnavailableError } from '../extraction-client'
import type { CasePayload } from '../case-payload'

// The only write across the boundary, so the tests here are mostly about what a
// half-finished sequence looks like from the outside. A case that exists but is
// reported as a failure is as bad as one that does not exist and is reported as
// a success — either way the user's next action is wrong.

function payload(overrides: Partial<CasePayload> = {}): CasePayload {
  return {
    case: {
      importer_eori: 'GB123456789000',
      importer_name: 'Midlands Steel Ltd',
      reporting_year: 2027,
      reporting_quarter: 1,
      jurisdiction: 'UK',
    },
    shipment: {
      origin_country: 'IN',
      entry_reference: 'MRN-1',
      incoterm: 'CIF',
      import_date: '2027-03-15',
    },
    lines: [
      {
        lineIndex: 0,
        cn_code: '72081000',
        product_description: 'Hot-rolled coil',
        net_mass_kg: 24000,
        origin_country: 'IN',
        installation_id: 'INST-1',
        emissions: {
          direct_emissions_kgco2e: 43200,
          indirect_emissions_kgco2e: null,
          calculation_method: 'actual',
          production_route: 'BF_BOF',
        },
      },
    ],
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

/** A fetch that answers each path with the given body, in call order. */
function routedFetch(routes: Record<string, unknown[]>) {
  const calls: { path: string; body: unknown }[] = []
  const impl = jest.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname
    calls.push({ path, body: JSON.parse(String(init?.body ?? '{}')) })
    const queue = routes[path]
    if (!queue || queue.length === 0) return jsonResponse({ detail: 'no route' }, 500)
    const next = queue.length === 1 ? queue[0] : queue.shift()
    if (next instanceof Error) throw next
    if (typeof next === 'number') return jsonResponse({ detail: 'boom' }, next)
    return jsonResponse(next)
  })
  return { impl, calls }
}

describe('createCbamCase', () => {
  const ORIGINAL = { ...process.env }

  beforeEach(() => {
    process.env.NUCLEOS_URL = 'https://nucleos.test'
    process.env.NUCLEOS_INTERNAL_TOKEN = 'token'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  it('creates case, shipment, goods line and emissions in order', async () => {
    const { impl, calls } = routedFetch({
      '/api/cbam/cases': [{ id: 'case-1' }],
      '/api/cbam/shipments': [{ id: 'ship-1' }],
      '/api/cbam/goods-lines': [{ id: 'line-1' }],
      '/api/cbam/emissions': [{ id: 'em-1' }],
    })

    const result = await createCbamCase(payload(), { fetchImpl: impl as never })

    expect(result.caseId).toBe('case-1')
    expect(result.goodsLineIds).toEqual(['line-1'])
    expect(result.problems).toEqual([])
    expect(calls.map(c => c.path)).toEqual([
      '/api/cbam/cases',
      '/api/cbam/shipments',
      '/api/cbam/goods-lines',
      '/api/cbam/emissions',
    ])
  })

  it('links each created row to the one above it', async () => {
    const { impl, calls } = routedFetch({
      '/api/cbam/cases': [{ id: 'case-1' }],
      '/api/cbam/shipments': [{ id: 'ship-1' }],
      '/api/cbam/goods-lines': [{ id: 'line-1' }],
      '/api/cbam/emissions': [{ id: 'em-1' }],
    })

    await createCbamCase(payload(), { fetchImpl: impl as never })

    expect(calls[1].body).toMatchObject({
      cbam_case_id: 'case-1',
      // Each to its own field. The MRN is not a customs procedure code.
      entry_reference: 'MRN-1',
      incoterm: 'CIF',
      import_date: '2027-03-15',
    })
    expect(calls[2].body).toMatchObject({ shipment_id: 'ship-1', installation_id: 'INST-1' })
    expect(calls[3].body).toMatchObject({ goods_line_id: 'line-1', version: 1 })
  })

  it('sends the internal token on every call', async () => {
    const { impl } = routedFetch({
      '/api/cbam/cases': [{ id: 'case-1' }],
      '/api/cbam/shipments': [{ id: 'ship-1' }],
      '/api/cbam/goods-lines': [{ id: 'line-1' }],
      '/api/cbam/emissions': [{ id: 'em-1' }],
    })

    await createCbamCase(payload(), { fetchImpl: impl as never })

    for (const call of impl.mock.calls) {
      const init = call[1] as RequestInit
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer token')
    }
  })

  // Nothing to report and nothing created — the caller can retry cleanly.
  it('throws when the case itself cannot be created', async () => {
    const { impl } = routedFetch({ '/api/cbam/cases': [500] })
    await expect(createCbamCase(payload(), { fetchImpl: impl as never })).rejects.toBeInstanceOf(
      NucleosUnavailableError,
    )
  })

  it('throws when Nucleos accepts the case but returns no id', async () => {
    const { impl } = routedFetch({ '/api/cbam/cases': [{ created: true }] })
    await expect(createCbamCase(payload(), { fetchImpl: impl as never })).rejects.toThrow(/no id/i)
  })

  // Past this point the case is real. Reporting a failure without the id would
  // orphan it: the user would retry and get a second case for one document.
  it('returns the case id when the shipment fails, and says what is missing', async () => {
    const { impl } = routedFetch({
      '/api/cbam/cases': [{ id: 'case-1' }],
      '/api/cbam/shipments': [500],
    })

    const result = await createCbamCase(payload(), { fetchImpl: impl as never })

    expect(result.caseId).toBe('case-1')
    expect(result.goodsLineIds).toEqual([])
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toMatch(/consignment/i)
  })

  it('keeps going after one goods line fails, and names the one that did', async () => {
    const two = payload()
    two.lines.push({
      lineIndex: 1,
      cn_code: '76011000',
      product_description: 'Unwrought aluminium',
      net_mass_kg: 5000,
      origin_country: 'IN',
      installation_id: null,
      emissions: null,
    })

    const { impl } = routedFetch({
      '/api/cbam/cases': [{ id: 'case-1' }],
      '/api/cbam/shipments': [{ id: 'ship-1' }],
      '/api/cbam/goods-lines': [422, { id: 'line-2' }],
      '/api/cbam/emissions': [{ id: 'em-1' }],
    })

    const result = await createCbamCase(two, { fetchImpl: impl as never })

    expect(result.caseId).toBe('case-1')
    expect(result.goodsLineIds).toEqual(['line-2'])
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toMatch(/Goods line 1 \(72081000\)/)
  })

  // The line still declares — on the published default, with the mark-up. The
  // user has to be told, or they will not know why the figure they supplied was
  // not the one used.
  it('reports a line whose emissions figure could not be recorded', async () => {
    const { impl } = routedFetch({
      '/api/cbam/cases': [{ id: 'case-1' }],
      '/api/cbam/shipments': [{ id: 'ship-1' }],
      '/api/cbam/goods-lines': [{ id: 'line-1' }],
      '/api/cbam/emissions': [500],
    })

    const result = await createCbamCase(payload(), { fetchImpl: impl as never })

    expect(result.caseId).toBe('case-1')
    expect(result.goodsLineIds).toEqual(['line-1'])
    expect(result.problems[0]).toMatch(/emissions figure/i)
  })

  it('posts no emissions record for a line that has no supplier figure', async () => {
    const noFigure = payload()
    noFigure.lines[0].emissions = null

    const { impl, calls } = routedFetch({
      '/api/cbam/cases': [{ id: 'case-1' }],
      '/api/cbam/shipments': [{ id: 'ship-1' }],
      '/api/cbam/goods-lines': [{ id: 'line-1' }],
    })

    const result = await createCbamCase(noFigure, { fetchImpl: impl as never })

    expect(result.problems).toEqual([])
    expect(calls.map(c => c.path)).not.toContain('/api/cbam/emissions')
  })

  it('refuses to call at all when Nucleos is not configured', async () => {
    delete process.env.NUCLEOS_URL
    const { impl } = routedFetch({})
    await expect(createCbamCase(payload(), { fetchImpl: impl as never })).rejects.toBeInstanceOf(
      NucleosUnavailableError,
    )
    expect(impl).not.toHaveBeenCalled()
  })
})
