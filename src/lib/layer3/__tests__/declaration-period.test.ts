// Layer 3 — the declaration calendar the Overview is organised around.
// The countdown is what gives coverage a reason to matter, so it is computed
// from the period close date, never written into copy.

import { currentDeclarationPeriod, lastPeriods } from '../declaration-period'

describe('currentDeclarationPeriod', () => {
  it('names the quarter the date falls in', () => {
    const p = currentDeclarationPeriod(new Date('2026-08-08T00:00:00Z'))
    expect(p.year).toBe(2026)
    expect(p.quarterLabel).toBe('Q3')
  })

  it('closes on the last day of the quarter', () => {
    const p = currentDeclarationPeriod(new Date('2026-08-08T00:00:00Z'))
    expect(p.closesOn.toISOString().slice(0, 10)).toBe('2026-09-30')
  })

  it('counts the days left, inclusive of today', () => {
    expect(currentDeclarationPeriod(new Date('2026-09-29T00:00:00Z')).daysToClose).toBe(1)
    expect(currentDeclarationPeriod(new Date('2026-09-30T00:00:00Z')).daysToClose).toBe(0)
  })

  it('handles the last quarter of the year', () => {
    const p = currentDeclarationPeriod(new Date('2026-12-01T00:00:00Z'))
    expect(p.quarterLabel).toBe('Q4')
    expect(p.closesOn.toISOString().slice(0, 10)).toBe('2026-12-31')
  })
})

describe('lastPeriods', () => {
  it('returns the requested number of quarters, oldest first, ending with the current one', () => {
    const ps = lastPeriods(new Date('2026-08-08T00:00:00Z'), 8)
    expect(ps).toHaveLength(8)
    expect(ps[7].label).toBe('Q3 2026')
    expect(ps[0].label).toBe('Q4 2024')
  })

  it('spans each quarter from first day to last', () => {
    const [p] = lastPeriods(new Date('2026-02-10T00:00:00Z'), 1)
    expect(p.start.toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(p.end.toISOString().slice(0, 10)).toBe('2026-03-31')
  })
})
