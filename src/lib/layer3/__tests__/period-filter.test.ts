// Layer 3 — which records a period question should return.
//
// The filter used to require containment: periodStart >= from AND periodEnd <=
// to. A record covering 2025-07-01 → 2026-07-01 was therefore excluded from
// "what did we record for 2026?", because its start falls in 2025 — even though
// most of it is 2026. A user asking about a period means records that overlap
// it, so that is what this builds.

import { periodOverlapWhere } from '../period-filter'

const iso = (d: Date) => d.toISOString().slice(0, 10)

describe('periodOverlapWhere', () => {
  it('returns no constraint when neither bound is given', () => {
    expect(periodOverlapWhere(null, null)).toEqual({})
    expect(periodOverlapWhere(undefined, undefined)).toEqual({})
  })

  it('overlaps rather than contains when both bounds are given', () => {
    // A record overlaps [from, to] when it starts on or before `to`
    // and ends on or after `from`.
    const where = periodOverlapWhere('2026-01-01', '2026-12-31')
    expect(iso(where.periodStart!.lte)).toBe('2026-12-31')
    expect(iso(where.periodEnd!.gte)).toBe('2026-01-01')
  })

  it('includes a record that straddles the start of the window', () => {
    // 2025-07-01 → 2026-07-01 asked about 2026: starts before the window ends,
    // ends after the window starts, so it overlaps and must be returned.
    const where = periodOverlapWhere('2026-01-01', '2026-12-31')
    const recordStart = new Date('2025-07-01')
    const recordEnd = new Date('2026-07-01')
    expect(recordStart <= where.periodStart!.lte).toBe(true)
    expect(recordEnd >= where.periodEnd!.gte).toBe(true)
  })

  it('excludes a record that ends before the window opens', () => {
    const where = periodOverlapWhere('2026-01-01', '2026-12-31')
    const recordEnd = new Date('2025-12-31')
    expect(recordEnd >= where.periodEnd!.gte).toBe(false)
  })

  it('excludes a record that starts after the window closes', () => {
    const where = periodOverlapWhere('2026-01-01', '2026-12-31')
    const recordStart = new Date('2027-01-01')
    expect(recordStart <= where.periodStart!.lte).toBe(false)
  })

  it('constrains only the end when just a start is given', () => {
    const where = periodOverlapWhere('2026-01-01', null)
    expect(where.periodStart).toBeUndefined()
    expect(iso(where.periodEnd!.gte)).toBe('2026-01-01')
  })

  it('constrains only the start when just an end is given', () => {
    const where = periodOverlapWhere(null, '2026-12-31')
    expect(where.periodEnd).toBeUndefined()
    expect(iso(where.periodStart!.lte)).toBe('2026-12-31')
  })

  it('ignores an unparseable date rather than filtering on Invalid Date', () => {
    expect(periodOverlapWhere('not-a-date', null)).toEqual({})
    expect(periodOverlapWhere(null, 'nonsense')).toEqual({})
  })
})
