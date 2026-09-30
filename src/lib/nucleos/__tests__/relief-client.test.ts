import { getHmrcExchangeRate, listQualifyingSchemes, listReliefClaims, recordReliefStatement } from '../relief-client'
import { VerificationRejectedError } from '../verification-client'
import { NucleosUnavailableError } from '../extraction-client'

// The Nucleos calls behind carbon price relief. Which schemes the UK recognises
// is Nucleos's reference data, not a list Arbor keeps.

const ORIGINAL = { ...process.env }
beforeEach(() => {
  process.env.NUCLEOS_URL = 'https://nucleos.test'
  process.env.NUCLEOS_INTERNAL_TOKEN = 'token'
})
afterEach(() => {
  process.env = { ...ORIGINAL }
})

function fake(status = 200, body: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

describe('relief client', () => {
  it('reads the schemes recognised for an origin country, with their currency', async () => {
    const { impl, calls } = fake(200, {
      country_code: 'SE',
      cpr_claimable: true,
      schemes: [
        { scheme_name: 'EU Emissions Trading System (EU ETS)', scheme_type: 'ets', recognition_status: 'confirmed', currency_code: 'EUR', notes: 'x' },
        { scheme_name: 'Swedish Carbon Tax', scheme_type: 'carbon_tax', recognition_status: 'confirmed', currency_code: 'SEK', notes: null },
      ],
      warning: null,
    })
    const out = await listQualifyingSchemes('se', impl)
    expect(calls[0].url).toBe('https://nucleos.test/api/cbam/cpr/qualifying-schemes?country=SE')
    expect(out).toEqual({
      claimable: true,
      warning: null,
      schemes: [
        { name: 'EU Emissions Trading System (EU ETS)', status: 'confirmed', currency: 'EUR' },
        { name: 'Swedish Carbon Tax', status: 'confirmed', currency: 'SEK' },
      ],
    })
  })

  it("reads a goods line's claims", async () => {
    const { impl, calls } = fake(200, { goods_line_id: 'gl-1', claims: [{ id: 'c-1' }], count: 1 })
    await expect(listReliefClaims('gl-1', impl)).resolves.toEqual([{ id: 'c-1' }])
    expect(calls[0].url).toBe('https://nucleos.test/api/cbam/cpr/claims/gl-1')
  })

  it('sends the relief statement as a reference and hash, never the file', async () => {
    const { impl, calls } = fake()
    await recordReliefStatement('gl-1', { documentRef: 'arbor:verification:stmt-1', sha256: 'a'.repeat(64) }, impl)
    expect(calls[0].url).toBe('https://nucleos.test/api/cbam/cpr/upload-verification/gl-1')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      document_ref: 'arbor:verification:stmt-1',
      document_sha256: 'a'.repeat(64),
    })
  })

  it('says when there is no claim waiting for a statement', async () => {
    await expect(
      recordReliefStatement('gl-1', { documentRef: 'r', sha256: 'a'.repeat(64) }, fake(404, { detail: 'none' }).impl),
    ).rejects.toBeInstanceOf(VerificationRejectedError)
  })

  it('fails closed otherwise', async () => {
    await expect(listReliefClaims('gl-1', fake(500).impl)).rejects.toBeInstanceOf(NucleosUnavailableError)
    await expect(listQualifyingSchemes('DE', fake(500).impl)).rejects.toBeInstanceOf(NucleosUnavailableError)
  })
})

describe('getHmrcExchangeRate', () => {
  it("reads HMRC's rate for the month of the date", async () => {
    const { impl, calls } = fake(200, {
      currency: 'EUR', date: '2027-04-15', rate: '0.8365', effective_from: '2027-04-01',
      source: 'HMRC monthly rates', table_version: '2027-uk-v1',
    })
    await expect(getHmrcExchangeRate('eur', '2027-04-15', impl)).resolves.toEqual({
      rate: '0.8365', effectiveFrom: '2027-04-01', source: 'HMRC monthly rates', tableVersion: '2027-uk-v1',
    })
    expect(calls[0].url).toBe('https://nucleos.test/api/cbam/cpr/exchange-rate?currency=EUR&date=2027-04-15')
  })

  it('treats a month Nucleos does not hold as no rate', async () => {
    await expect(getHmrcExchangeRate('EUR', '2027-05-15', fake(404, { detail: 'not held' }).impl)).resolves.toBeNull()
  })

  it('fails closed otherwise', async () => {
    await expect(getHmrcExchangeRate('EUR', '2027-05-15', fake(500, {}).impl)).rejects.toBeInstanceOf(NucleosUnavailableError)
  })
})
