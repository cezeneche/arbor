import { grantCoversRecord, anyGrantCoversRecord } from '@/lib/layer3/grant-scope'
import type { DataDomain } from '@prisma/client'

const rec = {
  domain: 'ENERGY' as DataDomain,
  periodStart: new Date('2026-04-01'),
  periodEnd: new Date('2026-06-30'),
}

describe('grantCoversRecord', () => {
  it('an unbounded grant (all null) covers any record', () => {
    expect(grantCoversRecord({ domain: null, periodStart: null, periodEnd: null }, rec)).toBe(true)
  })

  it('rejects a different domain', () => {
    expect(grantCoversRecord({ domain: 'LOGISTICS' as DataDomain, periodStart: null, periodEnd: null }, rec)).toBe(false)
  })

  it('matches the same domain', () => {
    expect(grantCoversRecord({ domain: 'ENERGY' as DataDomain, periodStart: null, periodEnd: null }, rec)).toBe(true)
  })

  it('rejects a record entirely before the grant period', () => {
    expect(grantCoversRecord({ domain: null, periodStart: new Date('2026-07-01'), periodEnd: null }, rec)).toBe(false)
  })

  it('rejects a record entirely after the grant period', () => {
    expect(grantCoversRecord({ domain: null, periodStart: null, periodEnd: new Date('2026-03-31') }, rec)).toBe(false)
  })

  it('accepts an overlapping period', () => {
    expect(
      grantCoversRecord({ domain: null, periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-12-31') }, rec),
    ).toBe(true)
  })

  it('anyGrantCoversRecord is true when one grant matches', () => {
    const grants = [
      { domain: 'LOGISTICS' as DataDomain, periodStart: null, periodEnd: null },
      { domain: 'ENERGY' as DataDomain, periodStart: null, periodEnd: null },
    ]
    expect(anyGrantCoversRecord(grants, rec)).toBe(true)
  })
})
