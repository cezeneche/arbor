import { cprDisplay } from '../cpr-display'

// The verification flag is non-blocking but must travel. An unverified claim is
// still payable and still reduces the liability, so refusing to show it would be
// wrong — presenting it as verified would be worse.

const BASE = {
  reliefAmount: 1840.5,
  reliefCurrency: 'GBP',
  verificationStatus: 'VERIFIED' as const,
  capped: false,
}

describe('cprDisplay', () => {
  it('always shows the amount — the claim is payable either way', () => {
    for (const status of ['VERIFIED', 'UNVERIFIED', 'NOT_APPLICABLE'] as const) {
      expect(cprDisplay({ ...BASE, verificationStatus: status }).amount).toBe('£1,840.50')
    }
  })

  it('does not withhold or zero an unverified claim', () => {
    // Unlike a placeholder-derived exposure figure, this number is real. The
    // uncertainty is about its provenance, not its value.
    const display = cprDisplay({ ...BASE, verificationStatus: 'UNVERIFIED' })
    expect(display.amount).toBe('£1,840.50')
    expect(display.amount).not.toContain('—')
  })

  it('breaks the scanning pattern when unverified', () => {
    expect(cprDisplay({ ...BASE, verificationStatus: 'UNVERIFIED' }).breaksPattern).toBe(true)
    expect(cprDisplay({ ...BASE, verificationStatus: 'VERIFIED' }).breaksPattern).toBe(false)
  })

  it('reuses the trust vocabulary so unverified reads as uncertain', () => {
    expect(cprDisplay({ ...BASE, verificationStatus: 'VERIFIED' }).band).toBe('high')
    expect(cprDisplay({ ...BASE, verificationStatus: 'UNVERIFIED' }).band).toBe('low')
    expect(cprDisplay({ ...BASE, verificationStatus: 'NOT_APPLICABLE' }).band).toBe('moderate')
  })

  it('says the relief still applies, so nobody reads the flag as a rejection', () => {
    const [first] = cprDisplay({ ...BASE, verificationStatus: 'UNVERIFIED' }).qualifications
    expect(first).toMatch(/not been verified/i)
    expect(first).toMatch(/still applies/i)
  })

  it('leads with why the figure might be wrong, not how it was derived', () => {
    // A reviewer scanning stops at the first line.
    const display = cprDisplay({
      ...BASE,
      verificationStatus: 'UNVERIFIED',
      exchangeRate: 0.8365,
      exchangeRateDate: '2026-04-01',
    })
    expect(display.qualifications[0]).toMatch(/not been verified/i)
    expect(display.qualifications[display.qualifications.length - 1]).toMatch(/Converted at/)
  })

  it('flags a non-qualifying scheme', () => {
    const display = cprDisplay({ ...BASE, schemeQualifying: false, scheme: 'Ruritanian ETS' })
    expect(display.qualifications.join(' ')).toContain('Ruritanian ETS')
    expect(display.breaksPattern).toBe(true)
  })

  it('explains a cap and shows what was claimed', () => {
    const display = cprDisplay({ ...BASE, capped: true, uncappedAmount: 2500 })
    const capLine = display.qualifications.find(q => q.includes('Capped'))
    expect(capLine).toContain('£2,500.00')
    expect(capLine).toMatch(/never exceeds/)
  })

  it('records the rate and its date together', () => {
    // A converted figure that cannot say which published rate produced it is not
    // reproducible.
    const display = cprDisplay({ ...BASE, exchangeRate: 0.8365, exchangeRateDate: '2026-04-01' })
    const line = display.qualifications.find(q => q.includes('Converted'))
    expect(line).toContain('0.8365')
    expect(line).toContain('2026-04-01')
  })

  it('adds no qualifications to a clean verified claim', () => {
    expect(cprDisplay(BASE).qualifications).toEqual([])
  })

  it('handles a currency with no symbol', () => {
    const display = cprDisplay({ ...BASE, reliefCurrency: 'TRY' })
    expect(display.amount).toBe('1,840.50 TRY')
  })
})
