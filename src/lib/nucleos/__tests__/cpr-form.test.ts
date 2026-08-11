import { qualifyingScheme, netLiability, missingForCalculation } from '../cpr-form'

// Carbon price relief reduces what an importer owes, so every one of these
// answers is money. The two that matter most: relief is only claimable where the
// origin country actually runs a qualifying scheme, and a relief larger than the
// liability does not produce a refund.

describe('qualifyingScheme', () => {
  it('recognises an EU member state as running a qualifying scheme', () => {
    const s = qualifyingScheme('DE')
    expect(s.eligible).toBe(true)
    expect(s.currency).toBe('EUR')
    expect(s.schemeName).toContain('EU Emissions Trading System')
  })

  it('names the Swiss scheme rather than the EU one, and prices it in francs', () => {
    // Switzerland's ETS is linked to the EU's but is a different scheme with a
    // different currency. Claiming under the wrong scheme name misstates the claim.
    const s = qualifyingScheme('CH')
    expect(s.eligible).toBe(true)
    expect(s.currency).toBe('CHF')
    expect(s.schemeName).toContain('Swiss')
  })

  it('includes EEA states that are not EU members', () => {
    expect(qualifyingScheme('NO').eligible).toBe(true)
    expect(qualifyingScheme('IS').eligible).toBe(true)
  })

  it('refuses a country with no qualifying scheme', () => {
    const s = qualifyingScheme('TR')
    expect(s.eligible).toBe(false)
    expect(s.schemeName).toBeNull()
  })

  it('is not case-sensitive about the country code', () => {
    expect(qualifyingScheme('de').eligible).toBe(true)
  })

  it('treats an absent origin as not eligible rather than throwing', () => {
    expect(qualifyingScheme(null).eligible).toBe(false)
  })
})

describe('netLiability', () => {
  it('subtracts the relief from what is owed', () => {
    expect(netLiability(1000, 250)).toBe(750)
  })

  it('floors at zero — relief reduces a bill, it does not pay one out', () => {
    // A negative net liability rendered on screen reads as money back from HMRC.
    expect(netLiability(1000, 1500)).toBe(0)
  })

  it('returns null when the liability is not yet known', () => {
    // Showing 0 here would say "you owe nothing", which is a different claim
    // from "we cannot tell you yet".
    expect(netLiability(null, 250)).toBeNull()
  })
})

describe('missingForCalculation', () => {
  const complete = { verifiedEmissions: '12.5', carbonPrice: '80', exchangeRate: '0.85' }

  it('is satisfied by a complete set of inputs', () => {
    expect(missingForCalculation(complete)).toEqual([])
  })

  it('names each missing input by its on-screen label', () => {
    const missing = missingForCalculation({ ...complete, verifiedEmissions: '' })
    expect(missing).toEqual(['Verified emissions'])
  })

  it('rejects a zero or negative emissions figure', () => {
    expect(missingForCalculation({ ...complete, verifiedEmissions: '0' })).toContain(
      'Verified emissions',
    )
  })

  it('accepts a carbon price of zero, which is a real answer', () => {
    // A scheme where the price settled at zero for the period is not a missing
    // input, and treating it as one blocks a legitimate nil claim.
    expect(missingForCalculation({ ...complete, carbonPrice: '0' })).toEqual([])
  })

  it('rejects a non-numeric entry rather than passing NaN to the engine', () => {
    expect(missingForCalculation({ ...complete, exchangeRate: 'abc' })).toContain('Exchange rate')
  })
})
