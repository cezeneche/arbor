import { buildRecordTrends, type TrendRecord } from '@/lib/layer3/record-trends'

// Layer 3, read-only. Groups records that already exist into a coverage-by-quarter
// view and a period-over-period table of STORED values. No new values are computed.

const compulsory = { ENERGY: ['consumption', 'supplier'] }

function rec(p: Partial<TrendRecord>): TrendRecord {
  return { domain: 'ENERGY', fieldName: 'consumption', trustTier: 'A', value: 1, unit: 'kWh', periodStart: '2026-01-01T00:00:00Z', ...p }
}

describe('buildRecordTrends', () => {
  it('returns empty structures for no records', () => {
    expect(buildRecordTrends([], compulsory)).toEqual({ quarters: [], periodOverPeriod: [] })
  })

  it('buckets records into quarters and detects missing compulsory fields per quarter', () => {
    // Q1 2026 has only `consumption` → `supplier` missing → 1 of 2 = 50%.
    const t = buildRecordTrends([rec({ fieldName: 'consumption', periodStart: '2026-02-01T00:00:00Z' })], compulsory)
    expect(t.quarters).toHaveLength(1)
    const q = t.quarters[0]
    expect(q.quarter).toBe('Q1 2026')
    const energy = q.domains.find(d => d.domain === 'ENERGY')!
    expect(energy.presentFields).toContain('consumption')
    expect(energy.missingFields).toEqual(['supplier'])
    expect(energy.pct).toBe(50)
  })

  it('orders quarters chronologically across year boundaries', () => {
    const t = buildRecordTrends(
      [
        rec({ fieldName: 'consumption', value: 10, periodStart: '2026-01-15T00:00:00Z' }), // Q1 2026
        rec({ fieldName: 'consumption', value: 20, periodStart: '2025-05-15T00:00:00Z' }), // Q2 2025 (earlier)
      ],
      compulsory,
    )
    expect(t.quarters.map(q => q.quarter)).toEqual(['Q2 2025', 'Q1 2026'])
    // period-over-period points follow the same chronological order
    const field = t.periodOverPeriod.find(f => f.fieldName === 'consumption')!
    expect(field.points.map(p => p.quarter)).toEqual(['Q2 2025', 'Q1 2026'])
    expect(field.points.map(p => p.value)).toEqual([20, 10])
  })

  it('only includes fields spanning two or more quarters in period-over-period', () => {
    const t = buildRecordTrends(
      [
        rec({ fieldName: 'consumption', periodStart: '2025-05-15T00:00:00Z' }),
        rec({ fieldName: 'consumption', periodStart: '2026-01-15T00:00:00Z' }),
        rec({ fieldName: 'supplier', periodStart: '2026-01-15T00:00:00Z' }), // single quarter only
      ],
      compulsory,
    )
    const fields = t.periodOverPeriod.map(f => f.fieldName)
    expect(fields).toContain('consumption')
    expect(fields).not.toContain('supplier')
  })

  it('surfaces fields beyond the compulsory set as extras', () => {
    const t = buildRecordTrends([rec({ fieldName: 'voltage', periodStart: '2026-02-01T00:00:00Z' })], compulsory)
    const energy = t.quarters[0].domains.find(d => d.domain === 'ENERGY')!
    expect(energy.extraFields).toContain('voltage')
  })
})
