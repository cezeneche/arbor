import { explainGoodsLineField } from '../explain-client'
import { NucleosUnavailableError } from '../extraction-client'

// Asking Nucleos what a goods line's figure rests on. A case opened before
// Arbor sent its evidence has none, which is an answer, not a failure.

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

describe('explainGoodsLineField', () => {
  it("asks for the field on Nucleos's own goods-line key", async () => {
    const { impl, urls } = fake(200, { chosen_value: 5000, evidence: [] })
    const body = await explainGoodsLineField('case-1', 'gl-1', 'net_mass_kg', { fetchImpl: impl })
    expect(urls[0]).toBe(
      'https://nucleos.test/api/cbam/cases/case-1/explain?field=goods_lines.gl-1.net_mass_kg',
    )
    expect(body).toEqual({ chosen_value: 5000, evidence: [] })
  })

  it('treats a case with no recorded evidence as nothing to show', async () => {
    const { impl } = fake(404, { detail: 'Not Found' })
    await expect(
      explainGoodsLineField('case-1', 'gl-1', 'net_mass_kg', { fetchImpl: impl }),
    ).resolves.toBeNull()
  })

  it('fails closed on any other error', async () => {
    const { impl } = fake(500, {})
    await expect(
      explainGoodsLineField('case-1', 'gl-1', 'net_mass_kg', { fetchImpl: impl }),
    ).rejects.toBeInstanceOf(NucleosUnavailableError)
  })
})
