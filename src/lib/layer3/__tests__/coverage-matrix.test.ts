// Layer 3 — §6. The centrepiece: record types against the last eight periods.
//
// Cell state is the WEAKEST tier present in that period, not the best. A period
// holding one Verified and one Declared record cannot be shown as Verified —
// the same meet rule the rest of the product uses for any aggregate claim.

import { buildCoverageMatrix, summariseCoverage, type CoverageRecord } from '../coverage-matrix'
import { lastPeriods } from '../declaration-period'

const NOW = new Date('2026-08-08T00:00:00Z')
const PERIODS = lastPeriods(NOW, 8)
const ONBOARDED = new Date('2025-01-01T00:00:00Z')

const rec = (o: Partial<CoverageRecord> = {}): CoverageRecord => ({
  domain: 'ENERGY',
  trustTier: 'A',
  periodStart: '2026-04-01',
  periodEnd: '2026-06-30',
  documentName: 'q2-electricity.pdf',
  ...o,
})

const build = (records: CoverageRecord[], onboardedAt: Date = ONBOARDED) =>
  buildCoverageMatrix({ records, periods: PERIODS, onboardedAt })

const stateAt = (rows: ReturnType<typeof build>, label: string) =>
  rows[0].cells.find(c => c.period.label === label)!.state

describe('buildCoverageMatrix', () => {
  it('has no rows when the org keeps nothing', () => {
    expect(build([])).toEqual([])
  })

  it('builds one row per record type the org actually keeps', () => {
    const rows = build([rec({ domain: 'ENERGY' }), rec({ domain: 'LOGISTICS' })])
    expect(rows.map(r => r.domain)).toEqual(['ENERGY', 'LOGISTICS'])
  })

  it('gives every row all eight periods', () => {
    expect(build([rec()])[0].cells).toHaveLength(8)
  })

  it('marks a period by the weakest tier present, never the best', () => {
    const rows = build([
      rec({ trustTier: 'A' }),
      rec({ trustTier: 'B' }),
    ])
    expect(stateAt(rows, 'Q2 2026')).toBe('declared')
  })

  it('distinguishes verified, declared and estimated', () => {
    expect(stateAt(build([rec({ trustTier: 'A' })]), 'Q2 2026')).toBe('verified')
    expect(stateAt(build([rec({ trustTier: 'B' })]), 'Q2 2026')).toBe('declared')
    expect(stateAt(build([rec({ trustTier: 'C' })]), 'Q2 2026')).toBe('estimated')
  })

  it('marks a period with nothing in it as missing', () => {
    expect(stateAt(build([rec()]), 'Q1 2026')).toBe('missing')
  })

  it('marks periods before onboarding as out of scope, not as gaps', () => {
    const rows = build([rec()], new Date('2026-01-01T00:00:00Z'))
    expect(stateAt(rows, 'Q4 2025')).toBe('out_of_scope')
    expect(stateAt(rows, 'Q1 2026')).toBe('missing')
  })

  it('counts a record in every period it spans', () => {
    const rows = build([rec({ periodStart: '2025-07-01', periodEnd: '2026-07-01' })])
    expect(stateAt(rows, 'Q4 2025')).toBe('verified')
    expect(stateAt(rows, 'Q1 2026')).toBe('verified')
    expect(stateAt(rows, 'Q2 2026')).toBe('verified')
  })

  it('carries the source document name for the cell tooltip', () => {
    const rows = build([rec({ documentName: 'q2-electricity.pdf' })])
    const cell = rows[0].cells.find(c => c.period.label === 'Q2 2026')!
    expect(cell.sourceDocument).toBe('q2-electricity.pdf')
    expect(cell.recordCount).toBe(1)
  })

  it('reports the most recent period covered', () => {
    const rows = build([rec({ periodStart: '2026-01-01', periodEnd: '2026-03-31' }), rec()])
    expect(rows[0].lastRecorded).toBe('Q2 2026')
  })

  it('says Never for a type with no record inside the window', () => {
    const rows = build([rec({ periodStart: '2020-01-01', periodEnd: '2020-03-31' })])
    expect(rows[0].lastRecorded).toBeNull()
  })
})

describe('summariseCoverage', () => {
  it('states the gap in words', () => {
    const rows = build([rec()])
    // One type, eight quarters, and every closed period but Q2 is empty.
    expect(summariseCoverage(rows)).toMatch(/^One record type, eight quarters\./)
    expect(summariseCoverage(rows)).toMatch(/gap/)
  })

  it('says so plainly when there are no gaps', () => {
    const full = PERIODS.map(p => rec({ periodStart: p.start, periodEnd: p.end }))
    expect(summariseCoverage(build(full))).toMatch(/No gaps\./)
  })

  it('counts types and gaps in words up to ten', () => {
    const rows = build([rec({ domain: 'ENERGY' }), rec({ domain: 'LOGISTICS' })])
    expect(summariseCoverage(rows)).toMatch(/^Two record types/)
  })
})
