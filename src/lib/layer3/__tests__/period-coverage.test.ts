// Layer 3 — "am I up to date?", which is the question an ops manager actually
// has. Bills and logs arrive on a cycle, so the failure that matters is a
// missing period, not a low record count. This builds the grid: the record
// types this business keeps, against the last four quarters.

import { recentQuarters, buildPeriodCoverage, type CoverageInput } from '../period-coverage'

const NOW = new Date('2026-08-07T12:00:00Z')

describe('recentQuarters', () => {
  it('ends with the quarter containing today', () => {
    const qs = recentQuarters(NOW)
    expect(qs[qs.length - 1].label).toBe('Q3 2026')
  })

  it('returns four quarters, oldest first', () => {
    expect(recentQuarters(NOW).map(q => q.label)).toEqual(['Q4 2025', 'Q1 2026', 'Q2 2026', 'Q3 2026'])
  })

  it('crosses the year boundary correctly', () => {
    expect(recentQuarters(new Date('2026-02-10T00:00:00Z')).map(q => q.label))
      .toEqual(['Q2 2025', 'Q3 2025', 'Q4 2025', 'Q1 2026'])
  })

  it('spans each quarter from its first day to its last', () => {
    const [q] = recentQuarters(new Date('2026-01-15T00:00:00Z'), 1)
    expect(q.start.toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(q.end.toISOString().slice(0, 10)).toBe('2026-03-31')
  })
})

const input = (over: Partial<CoverageInput> = {}): CoverageInput => ({
  records: [],
  pending: [],
  now: NOW,
  ...over,
})

describe('buildPeriodCoverage', () => {
  it('is empty when the business keeps no records at all', () => {
    expect(buildPeriodCoverage(input())).toEqual([])
  })

  it('marks a quarter recorded when a record overlaps it, and a later closed blank one as a gap', () => {
    const rows = buildPeriodCoverage(input({
      records: [{ domain: 'ENERGY', periodStart: '2025-10-01', periodEnd: '2025-12-31' }],
    }))
    const cells = rows[0].cells
    expect(cells.find(c => c.quarter.label === 'Q4 2025')!.state).toBe('recorded')
    expect(cells.find(c => c.quarter.label === 'Q1 2026')!.state).toBe('missing')
  })

  it('marks every quarter a long record spans, not just the one it starts in', () => {
    // A bill running July to July belongs to every quarter it covers.
    const rows = buildPeriodCoverage(input({
      records: [{ domain: 'ENERGY', periodStart: '2025-07-01', periodEnd: '2026-07-01' }],
    }))
    const states = rows[0].cells.map(c => `${c.quarter.label}:${c.state}`)
    expect(states).toEqual([
      'Q4 2025:recorded', 'Q1 2026:recorded', 'Q2 2026:recorded', 'Q3 2026:recorded',
    ])
  })

  it('counts how many records land in a quarter', () => {
    const rows = buildPeriodCoverage(input({
      records: [
        { domain: 'ENERGY', periodStart: '2026-04-01', periodEnd: '2026-06-30' },
        { domain: 'ENERGY', periodStart: '2026-05-01', periodEnd: '2026-05-31' },
      ],
    }))
    expect(rows[0].cells.find(c => c.quarter.label === 'Q2 2026')!.count).toBe(2)
  })

  it('shows a quarter as awaiting a check when a document arrived but was never confirmed', () => {
    // Arrived but unconfirmed is not the same as missing — the user has the
    // document, they just have not cleared it, and the fix is different.
    const rows = buildPeriodCoverage(input({
      pending: [{ domain: 'ENERGY', periodStart: '2026-07-01', periodEnd: '2026-09-30' }],
    }))
    expect(rows[0].cells.find(c => c.quarter.label === 'Q3 2026')!.state).toBe('awaiting_check')
  })

  it('prefers recorded over awaiting when both exist for a quarter', () => {
    const rows = buildPeriodCoverage(input({
      records: [{ domain: 'ENERGY', periodStart: '2026-07-01', periodEnd: '2026-09-30' }],
      pending: [{ domain: 'ENERGY', periodStart: '2026-07-01', periodEnd: '2026-09-30' }],
    }))
    expect(rows[0].cells.find(c => c.quarter.label === 'Q3 2026')!.state).toBe('recorded')
  })

  it('only builds rows for record types this business actually keeps', () => {
    const rows = buildPeriodCoverage(input({
      records: [{ domain: 'ENERGY', periodStart: '2026-04-01', periodEnd: '2026-06-30' }],
    }))
    expect(rows.map(r => r.domain)).toEqual(['ENERGY'])
    expect(rows.map(r => r.domain)).not.toContain('AGRICULTURE')
  })

  it('includes a row for a type that only has an unconfirmed document', () => {
    const rows = buildPeriodCoverage(input({
      pending: [{ domain: 'PRODUCTION', periodStart: '2026-07-01', periodEnd: '2026-09-30' }],
    }))
    expect(rows.map(r => r.domain)).toEqual(['PRODUCTION'])
  })

  it('orders rows by the canonical domain order, not by arrival', () => {
    const rows = buildPeriodCoverage(input({
      records: [
        { domain: 'LOGISTICS', periodStart: '2026-04-01', periodEnd: '2026-06-30' },
        { domain: 'ENERGY', periodStart: '2026-04-01', periodEnd: '2026-06-30' },
      ],
    }))
    expect(rows.map(r => r.domain)).toEqual(['ENERGY', 'LOGISTICS'])
  })

  it('carries a plain English label for each row', () => {
    const rows = buildPeriodCoverage(input({
      records: [{ domain: 'WASTE_AND_WATER', periodStart: '2026-04-01', periodEnd: '2026-06-30' }],
    }))
    expect(rows[0].domainLabel).toBe('Waste & Water')
  })

  it('reports the most recent period covered, for a freshness read', () => {
    const rows = buildPeriodCoverage(input({
      records: [
        { domain: 'ENERGY', periodStart: '2026-01-01', periodEnd: '2026-03-31' },
        { domain: 'ENERGY', periodStart: '2026-04-01', periodEnd: '2026-06-30' },
      ],
    }))
    expect(rows[0].lastCovered).toBe('Q2 2026')
  })

  it('reports no last period when only an unconfirmed document exists', () => {
    const rows = buildPeriodCoverage(input({
      pending: [{ domain: 'ENERGY', periodStart: '2026-07-01', periodEnd: '2026-09-30' }],
    }))
    expect(rows[0].lastCovered).toBeNull()
  })

  it('ignores records that fall entirely outside the window', () => {
    const rows = buildPeriodCoverage(input({
      records: [{ domain: 'ENERGY', periodStart: '2020-01-01', periodEnd: '2020-12-31' }],
    }))
    // The type is still kept, but no cell in the visible window is recorded.
    expect(rows[0].cells.every(c => c.state !== 'recorded')).toBe(true)
  })

  it('does not call the quarter we are still in a gap', () => {
    // NOW is 7 August, a month into Q3. The quarter has not finished, so the
    // bill for it has not arrived — calling that "missing" paints a red column
    // down every row for two thirds of every quarter, and the grid stops
    // meaning anything.
    const rows = buildPeriodCoverage(input({
      records: [{ domain: 'ENERGY', periodStart: '2026-01-01', periodEnd: '2026-03-31' }],
    }))
    const byQuarter = Object.fromEntries(rows[0].cells.map(c => [c.quarter.label, c.state]))
    expect(byQuarter['Q3 2026']).toBe('in_progress')
    // The quarter that has closed with nothing in it is still a real gap.
    expect(byQuarter['Q2 2026']).toBe('missing')
  })

  it('still shows the current quarter as recorded once something lands in it', () => {
    const rows = buildPeriodCoverage(input({
      records: [{ domain: 'ENERGY', periodStart: '2026-07-01', periodEnd: '2026-09-30' }],
    }))
    const byQuarter = Object.fromEntries(rows[0].cells.map(c => [c.quarter.label, c.state]))
    expect(byQuarter['Q3 2026']).toBe('recorded')
  })

  it('does not call a quarter missing when it predates the first record of that type', () => {
    // A business that started keeping energy records in Q2 has not "missed"
    // Q4 last year. Marking it as a gap invents a failure that never happened,
    // and a wall of red on day one teaches the user to ignore the grid.
    const rows = buildPeriodCoverage(input({
      records: [{ domain: 'ENERGY', periodStart: '2026-01-01', periodEnd: '2026-03-31' }],
    }))
    const byQuarter = Object.fromEntries(rows[0].cells.map(c => [c.quarter.label, c.state]))
    expect(byQuarter['Q4 2025']).toBe('before_first')
    expect(byQuarter['Q1 2026']).toBe('recorded')
    // After the first record, a quarter that has closed with nothing is a real gap.
    expect(byQuarter['Q2 2026']).toBe('missing')
  })

  it('treats an unconfirmed document as the start of the history too', () => {
    const rows = buildPeriodCoverage(input({
      pending: [{ domain: 'PRODUCTION', periodStart: '2026-01-01', periodEnd: '2026-03-31' }],
    }))
    const byQuarter = Object.fromEntries(rows[0].cells.map(c => [c.quarter.label, c.state]))
    expect(byQuarter['Q4 2025']).toBe('before_first')
    expect(byQuarter['Q1 2026']).toBe('awaiting_check')
  })
})
