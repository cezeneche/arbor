/**
 * HMRC's exchange rate for a relief claim, for the form to fill in. Read-only
 * reference data; a month Nucleos does not hold is an answer, not a failure.
 */

const reader = { user: { id: 'user-1', entityId: 'ent-1', role: 'VIEWER' } }
jest.mock('@/lib/auth-helpers', () => ({
  requireAuth: jest.fn(async () => ({ session: reader, response: null })),
}))
const rate = jest.fn()
jest.mock('@/lib/nucleos/relief-client', () => ({ getHmrcExchangeRate: (...a: unknown[]) => rate(...a) }))

import { GET } from '../relief/exchange-rate/route'
import { NucleosUnavailableError } from '@/lib/nucleos/extraction-client'

const get = (q: string) => GET(new Request(`http://arbor.test/api/cbam/relief/exchange-rate?${q}`))

beforeEach(() => jest.clearAllMocks())

describe('GET relief exchange rate', () => {
  it("returns HMRC's rate for the month, named", async () => {
    rate.mockResolvedValue({
      rate: '0.8365',
      effectiveFrom: '2027-04-01',
      source: 'HMRC monthly rates',
      tableVersion: '2027-uk-v1',
    })
    const res = await get('currency=EUR&date=2027-04-15')
    expect(res.status).toBe(200)
    expect(rate).toHaveBeenCalledWith('EUR', '2027-04-15')
    expect(await res.json()).toEqual({
      held: true,
      rate: '0.8365',
      label: 'HMRC’s EUR rate for April 2027 (reference table 2027-uk-v1)',
    })
  })

  it('says plainly when the month is not held', async () => {
    rate.mockResolvedValue(null)
    const res = await get('currency=EUR&date=2027-05-15')
    expect(await res.json()).toEqual({
      held: false,
      message: 'HMRC’s EUR rate for May 2027 is not held yet. Enter it from HMRC’s monthly exchange rates.',
    })
  })

  it('refuses a malformed request before asking Nucleos', async () => {
    expect((await get('currency=EURO&date=2027-05-15')).status).toBe(400)
    expect((await get('currency=EUR&date=15/05/2027')).status).toBe(400)
    expect(rate).not.toHaveBeenCalled()
  })

  it('says when Nucleos cannot be reached', async () => {
    rate.mockRejectedValue(new NucleosUnavailableError('down'))
    expect((await get('currency=EUR&date=2027-05-15')).status).toBe(502)
  })
})
