import { missingForCalculation } from '../cpr-form'

// Carbon price relief reduces what an importer owes, so every one of these
// answers is money. Which schemes qualify is Nucleos's reference data now (see
// relief-presenter), and the return caps relief at each line's charge; what
// stays here is that a claim is not made on missing figures.

describe('missingForCalculation', () => {
  const complete = {
    verifiedEmissions: '12.5',
    carbonPrice: '80',
    currency: 'EUR',
    exchangeRate: '0.85',
    rateDate: '2027-04-15',
  }

  it('is satisfied by a complete set of inputs', () => {
    expect(missingForCalculation(complete)).toEqual([])
  })

  it('names each missing input by its on-screen label', () => {
    const missing = missingForCalculation({ ...complete, verifiedEmissions: '' })
    expect(missing).toEqual(['Verified emissions'])
  })

  it('rejects a zero or negative emissions figure', () => {
    expect(missingForCalculation({ ...complete, verifiedEmissions: '0' })).toContain('Verified emissions')
  })

  it('accepts a carbon price of zero, which is a real answer', () => {
    // A scheme where the price settled at zero for the period is not a missing
    // input, and treating it as one blocks a legitimate nil claim.
    expect(missingForCalculation({ ...complete, carbonPrice: '0' })).toEqual([])
  })

  it('rejects a non-numeric entry rather than passing NaN to the engine', () => {
    expect(missingForCalculation({ ...complete, exchangeRate: 'abc' })).toContain('Exchange rate')
  })

  // The rate used to be stamped with the day the claim was made. HMRC's rate is
  // the one for the import date, so the claim has to say which date it used.
  it('needs the date the exchange rate applies to', () => {
    expect(missingForCalculation({ ...complete, rateDate: '' })).toEqual(['Date of the exchange rate'])
    expect(missingForCalculation({ ...complete, rateDate: '15/04/2027' })).toEqual([
      'Date of the exchange rate',
    ])
  })

  it('needs the currency the carbon price was paid in', () => {
    expect(missingForCalculation({ ...complete, currency: 'eu' })).toEqual(['Currency'])
  })
})
