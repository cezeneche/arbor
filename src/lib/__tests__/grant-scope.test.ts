import {
  grantCoversRecord,
  anyGrantCoversRecord,
  parseGrantFieldNames,
} from '@/lib/layer3/grant-scope'
import type { DataDomain } from '@prisma/client'

const rec = {
  domain: 'ENERGY' as DataDomain,
  periodStart: new Date('2026-04-01'),
  periodEnd: new Date('2026-06-30'),
  fieldName: 'total_consumption_kwh',
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

describe('grantCoversRecord — field scope', () => {
  const unscoped = { domain: null, periodStart: null, periodEnd: null }

  it('a grant with no field list covers every field, as before', () => {
    expect(grantCoversRecord({ ...unscoped, fieldNames: null }, rec)).toBe(true)
    expect(grantCoversRecord(unscoped, rec)).toBe(true)
  })

  it('covers a field the grant names', () => {
    expect(
      grantCoversRecord({ ...unscoped, fieldNames: ['total_consumption_kwh'] }, rec),
    ).toBe(true)
  })

  // The defect: answering a request for one named field opened the whole domain
  // and period, so the buyer could read figures they never asked for.
  it('does not cover a different field in the same domain and period', () => {
    expect(grantCoversRecord({ ...unscoped, fieldNames: ['meter_reference'] }, rec)).toBe(false)
  })

  it('treats a record with no field name as out of scope for a field-scoped grant', () => {
    const anonymous = { domain: rec.domain, periodStart: rec.periodStart, periodEnd: rec.periodEnd }
    expect(grantCoversRecord({ ...unscoped, fieldNames: ['total_consumption_kwh'] }, anonymous)).toBe(
      false,
    )
  })

  it('an empty field list is treated as unrestricted, not as covering nothing', () => {
    expect(grantCoversRecord({ ...unscoped, fieldNames: [] }, rec)).toBe(true)
  })
})

describe('parseGrantFieldNames', () => {
  it('reads a stored array of names', () => {
    expect(parseGrantFieldNames(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('treats null, a non-array, or an empty array as unrestricted', () => {
    expect(parseGrantFieldNames(null)).toBeNull()
    expect(parseGrantFieldNames('a')).toBeNull()
    expect(parseGrantFieldNames([])).toBeNull()
  })

  it('drops non-string entries rather than failing the whole grant', () => {
    expect(parseGrantFieldNames(['a', 3, null, 'b'])).toEqual(['a', 'b'])
  })
})
