// Layer 3 — the one-click questions offered above the query box.
//
// The shipped suggestions were written blind ("energy records for last year")
// and returned nothing on a store whose energy records are all this year. A
// suggestion that returns nothing teaches the user the feature is broken, so
// these are built from what the entity actually holds.

import { buildQuerySuggestions } from '../query-suggestions'

describe('buildQuerySuggestions', () => {
  it('names only domains the entity actually has records in', () => {
    const s = buildQuerySuggestions({ domains: ['ENERGY', 'LOGISTICS'], latestYear: 2026 })
    const joined = s.join(' | ').toLowerCase()
    expect(joined).toContain('energy')
    expect(joined).toContain('logistics')
    expect(joined).not.toContain('agriculture')
    expect(joined).not.toContain('emissions')
  })

  it('asks about the year the records are actually in', () => {
    const s = buildQuerySuggestions({ domains: ['ENERGY'], latestYear: 2026 })
    expect(s.join(' ')).toContain('2026')
  })

  it('never says "last year", which resolves away from the stored data', () => {
    const s = buildQuerySuggestions({ domains: ['ENERGY'], latestYear: 2026 })
    expect(s.join(' ').toLowerCase()).not.toContain('last year')
  })

  it('falls back to starter prompts when the store is empty', () => {
    const s = buildQuerySuggestions({ domains: [], latestYear: null })
    expect(s.length).toBeGreaterThan(0)
    // Nothing that promises data the entity does not have.
    expect(s.join(' ')).not.toMatch(/\b20\d\d\b/)
  })

  it('offers a small, glanceable set', () => {
    const s = buildQuerySuggestions({
      domains: ['ENERGY', 'LOGISTICS', 'PRODUCTION', 'MATERIALS', 'EMISSIONS'],
      latestYear: 2026,
    })
    expect(s.length).toBeLessThanOrEqual(3)
  })

  it('uses plain English domain names, never the domain codes', () => {
    const s = buildQuerySuggestions({ domains: ['WASTE_AND_WATER'], latestYear: 2026 })
    expect(s.join(' ')).not.toContain('WASTE_AND_WATER')
    expect(s.join(' ').toLowerCase()).toContain('waste')
  })

  it('is stable for the same input', () => {
    const a = buildQuerySuggestions({ domains: ['ENERGY', 'LOGISTICS'], latestYear: 2026 })
    const b = buildQuerySuggestions({ domains: ['ENERGY', 'LOGISTICS'], latestYear: 2026 })
    expect(a).toEqual(b)
  })
})
