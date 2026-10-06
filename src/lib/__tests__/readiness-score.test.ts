import { supplierReadiness } from '../readiness-score'

// The buyer's supply-chain view showed each supplier's "readiness" as the share
// of their records that were Verified, green at 75%. A supplier with one
// Verified record and nothing else showed 100%. Readiness is now measured
// against what the buyer asked this supplier for, and verification is reported
// beside it rather than blended into it.

const d = (iso: string) => new Date(iso)
const q1 = { periodStart: d('2026-01-01'), periodEnd: d('2026-03-31') }

const request = (over: Partial<Parameters<typeof supplierReadiness>[0]['requests'][number]> = {}) => ({
  domain: 'ENERGY',
  requiredFields: ['total_consumption_kwh', 'total_consumption_m3'],
  ...q1,
  ...over,
})
const record = (fieldName: string, trustTier: 'A' | 'B' | 'C', over: object = {}) => ({
  domain: 'ENERGY',
  fieldName,
  trustTier,
  ...q1,
  ...over,
})

describe('supplierReadiness', () => {
  it('is null when nothing has been requested, so no score is shown', () => {
    expect(supplierReadiness({ requests: [], records: [record('total_consumption_kwh', 'A')] })).toBeNull()
  })

  it('counts each requested figure, and whether it was supplied and verified', () => {
    expect(
      supplierReadiness({ requests: [request()], records: [record('total_consumption_kwh', 'A')] }),
    ).toEqual({ requested: 2, supplied: 1, verified: 1 })
  })

  // The case the old score got backwards.
  it('does not call one verified record complete', () => {
    const r = supplierReadiness({
      requests: [request({ requiredFields: ['a', 'b', 'c', 'd'] })],
      records: [record('a', 'A')],
    })
    expect(r).toEqual({ requested: 4, supplied: 1, verified: 1 })
  })

  it('counts a figure supplied but only Declared as supplied, not verified', () => {
    expect(
      supplierReadiness({
        requests: [request({ requiredFields: ['total_consumption_kwh'] })],
        records: [record('total_consumption_kwh', 'B')],
      }),
    ).toEqual({ requested: 1, supplied: 1, verified: 0 })
  })

  it('needs the record to cover the requested period and area', () => {
    const r = supplierReadiness({
      requests: [request({ requiredFields: ['total_consumption_kwh'] })],
      records: [
        record('total_consumption_kwh', 'A', { periodStart: d('2025-01-01'), periodEnd: d('2025-03-31') }),
        record('total_consumption_kwh', 'A', { domain: 'LOGISTICS' }),
      ],
    })
    expect(r).toEqual({ requested: 1, supplied: 0, verified: 0 })
  })

  it('treats a request naming no fields as asking for anything in its area', () => {
    expect(
      supplierReadiness({ requests: [request({ requiredFields: [] })], records: [record('anything', 'A')] }),
    ).toEqual({ requested: 1, supplied: 1, verified: 1 })
  })
})
