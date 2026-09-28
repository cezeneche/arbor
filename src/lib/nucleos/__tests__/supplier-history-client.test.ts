import { getSupplierHistory } from '../supplier-history-client'
import { NucleosUnavailableError } from '../extraction-client'

// Reading a goods line's supplier history from Nucleos.

const ORIGINAL = { ...process.env }
beforeEach(() => {
  process.env.NUCLEOS_URL = 'https://nucleos.test'
  process.env.NUCLEOS_INTERNAL_TOKEN = 'token'
})
afterEach(() => {
  process.env = { ...ORIGINAL }
})

function fake(status: number, body: unknown) {
  const urls: string[] = []
  const impl = jest.fn(async (url: string) => {
    urls.push(url)
    return new Response(JSON.stringify(body), { status })
  })
  return { impl: impl as unknown as typeof fetch, urls }
}

describe('getSupplierHistory', () => {
  it('reads the history for the goods line', async () => {
    const { impl, urls } = fake(200, { flagged: false, history: [] })
    await expect(getSupplierHistory('gl-1', impl)).resolves.toEqual({ flagged: false, history: [] })
    expect(urls[0]).toBe('https://nucleos.test/api/cbam/goods-lines/gl-1/supplier-history')
  })

  it('treats a line Nucleos cannot find as having no history', async () => {
    await expect(getSupplierHistory('gl-1', fake(404, { detail: 'Goods line not found' }).impl)).resolves.toBeNull()
  })

  it('fails closed otherwise', async () => {
    await expect(getSupplierHistory('gl-1', fake(500, {}).impl)).rejects.toBeInstanceOf(NucleosUnavailableError)
  })
})
