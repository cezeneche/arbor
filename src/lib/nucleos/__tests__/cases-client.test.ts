import { listCbamCases } from '../cases-client'

// The case list is scoped to the caller's own cases. Nucleos is asked for those
// ids only, and whatever comes back is filtered to them again — a Nucleos that
// ignored the filter, or predates it, would otherwise hand one organisation
// every case under the shared service token.

function respond(body: unknown) {
  return jest.fn(async (_url: string) => new Response(JSON.stringify(body), { status: 200 }))
}

const row = (id: string) => ({ id, importer_name: `Importer ${id}` })

beforeEach(() => {
  process.env.NUCLEOS_URL = 'https://nucleos.test'
  process.env.NUCLEOS_INTERNAL_TOKEN = 'service-token'
})

describe('listCbamCases', () => {
  it('asks Nucleos for nothing when the organisation owns no cases', async () => {
    const fetchImpl = respond({ items: [row('case-B')] })
    const page = await listCbamCases({ ids: [], fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(page).toEqual({ items: [], total: 0 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('asks Nucleos for the owned ids only', async () => {
    const fetchImpl = respond({ items: [row('case-A1')] })
    await listCbamCases({ ids: ['case-A1', 'case-A2'], fetchImpl: fetchImpl as unknown as typeof fetch })
    const url = new URL(fetchImpl.mock.calls[0][0])
    expect(url.searchParams.get('ids')).toBe('case-A1,case-A2')
  })

  it('drops any case Nucleos returns that the organisation does not own', async () => {
    const fetchImpl = respond({ items: [row('case-A1'), row('case-B'), row('case-A2')] })
    const page = await listCbamCases({
      ids: ['case-A1', 'case-A2'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(page.items.map(c => c.id)).toEqual(['case-A1', 'case-A2'])
  })

  it('reports the total as the number of cases the organisation owns', async () => {
    const fetchImpl = respond({ items: [row('case-A1')], count: 1 })
    const page = await listCbamCases({
      ids: ['case-A1', 'case-A2', 'case-A3'],
      limit: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(page.total).toBe(3)
  })

  it('pages over the owned ids rather than over every case in Nucleos', async () => {
    const fetchImpl = respond({ items: [row('case-A3')] })
    await listCbamCases({
      ids: ['case-A1', 'case-A2', 'case-A3'],
      limit: 2,
      offset: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const url = new URL(fetchImpl.mock.calls[0][0])
    expect(url.searchParams.get('ids')).toBe('case-A3')
    expect(url.searchParams.get('offset')).toBe('0')
  })
})
