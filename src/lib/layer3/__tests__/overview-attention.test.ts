// Layer 3 — §4. The severity model, as one pure function.
//
// The distinction the whole block turns on: `blocking` prevents a declaration
// or costs money, `attention` needs doing but nothing is at stake this period.
// Absence is ambiguous to a manager — it could mean all clear or never checked
// — so the function always returns a state, and `clear` carries its own line.

import { buildAttention, type AttentionInput } from '../overview-attention'

const NOW = new Date('2026-08-08T00:00:00Z') // Q3 2026 closes 30 Sep, 53 days out

const input = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  now: NOW,
  records: [],
  requests: [],
  documents: [],
  unitConflicts: [],
  disagreements: [],
  ...over,
})

const rec = (o: Record<string, unknown> = {}) => ({
  id: 'r1',
  domain: 'ENERGY',
  fieldName: 'total_consumption_kwh',
  value: 100,
  unit: 'mj',
  trustTier: 'A' as const,
  periodStart: '2026-07-01',
  periodEnd: '2026-09-30',
  ...o,
})

describe('state', () => {
  it('is clear when nothing is wrong', () => {
    const r = buildAttention(input({ records: [rec()] }))
    expect(r.state).toBe('clear')
    expect(r.blocking).toEqual([])
    expect(r.attention).toEqual([])
  })

  it('carries a one-line clear message naming what is next due', () => {
    const r = buildAttention(input({ records: [rec()] }))
    expect(r.clearLine).toMatch(/^Nothing needs you\./)
    expect(r.clearLine).toMatch(/Energy/)
    expect(r.clearLine).toMatch(/Q[1-4] 2026/)
  })

  it('is attention when something needs doing but nothing is at stake', () => {
    const r = buildAttention(input({
      records: [rec()],
      documents: [{ id: 'd1', fileName: 'q3.pdf', status: 'REVIEW_REQUIRED', valueCount: 4 }],
    }))
    expect(r.state).toBe('attention')
    expect(r.clearLine).toBeNull()
  })

  it('is blocking as soon as one blocking item exists, whatever else is present', () => {
    const r = buildAttention(input({
      records: [rec()],
      documents: [
        { id: 'd1', fileName: 'q3.pdf', status: 'REVIEW_REQUIRED', valueCount: 4 },
        { id: 'd2', fileName: 'broken.pdf', status: 'REJECTED', errorMessage: 'The file is password protected' },
      ],
    }))
    expect(r.state).toBe('blocking')
    // Attention items survive; the renderer places them after Totals.
    expect(r.attention).toHaveLength(1)
  })
})

describe('blocking conditions', () => {
  it('raises a record type with no record for a period closing within 45 days', () => {
    // Q3 closes in 53 days, so a Q3 gap is not yet blocking.
    const far = buildAttention(input({
      records: [rec({ periodStart: '2026-04-01', periodEnd: '2026-06-30' })],
    }))
    expect(far.blocking).toEqual([])

    // Ten days out, the same gap blocks.
    const near = buildAttention(input({
      now: new Date('2026-09-20T00:00:00Z'),
      records: [rec({ periodStart: '2026-04-01', periodEnd: '2026-06-30' })],
    }))
    expect(near.blocking).toHaveLength(1)
    expect(near.blocking[0].sentence).toMatch(/Q3 2026/)
    expect(near.blocking[0].sentence).toMatch(/Estimated/)
  })

  it('raises a document that failed to parse, naming the file and the reason', () => {
    const r = buildAttention(input({
      documents: [{ id: 'd2', fileName: 'heartlands-energy-q3.pdf', status: 'REJECTED', errorMessage: 'The file is password protected' }],
    }))
    expect(r.blocking[0].sentence).toContain('heartlands-energy-q3.pdf')
    expect(r.blocking[0].sentence).toContain('password protected')
    expect(r.blocking[0].actionLabel).toBe('Upload again')
  })

  it('raises two records for the same type and period that disagree', () => {
    const r = buildAttention(input({
      disagreements: [{ fieldName: 'total_consumption_kwh', discrepancyPercent: 18 }],
    }))
    expect(r.blocking[0].sentence).toMatch(/disagree|differ/i)
    expect(r.blocking[0].sentence).toContain('18')
  })

  it('raises a record whose unit is inconsistent with its type', () => {
    const r = buildAttention(input({
      unitConflicts: [{ recordId: 'r9', domain: 'ENERGY', fieldName: 'total_consumption_kwh', unit: 'kWh', expected: 'mj' }],
    }))
    expect(r.blocking[0].sentence).toContain('kWh')
    expect(r.blocking[0].sentence).toContain('mj')
  })

  it('states one unit problem per record type, not one per record', () => {
    // Ten bills written in the wrong unit are one mistake to fix. Ten identical
    // sentences is a wall the reader stops reading.
    const conflict = { domain: 'ENERGY', fieldName: 'total_consumption_kwh', unit: 'kWh', expected: 'mj' }
    const r = buildAttention(input({
      unitConflicts: [
        { recordId: 'a', ...conflict },
        { recordId: 'b', ...conflict },
        { recordId: 'c', ...conflict },
      ],
    }))
    expect(r.blocking).toHaveLength(1)
    expect(r.blocking[0].sentence).toMatch(/^3 total consumption kwh records are/)
  })
})

describe('attention conditions', () => {
  it('raises an outbound request past its due date', () => {
    const r = buildAttention(input({
      requests: [{ id: 'q1', counterpartyName: 'Northern Foods', domain: 'ENERGY', deadline: '2026-07-01' }],
    }))
    expect(r.attention[0].sentence).toContain('Northern Foods')
    expect(r.attention[0].severity).toBe('attention')
  })

  it('leaves a request that is not yet due alone', () => {
    const r = buildAttention(input({
      requests: [{ id: 'q1', counterpartyName: 'Northern Foods', domain: 'ENERGY', deadline: '2026-12-01' }],
    }))
    expect(r.attention).toEqual([])
  })

  it('raises drafts awaiting review', () => {
    const r = buildAttention(input({
      documents: [{ id: 'd1', fileName: 'q3.pdf', status: 'REVIEW_REQUIRED', valueCount: 4 }],
    }))
    expect(r.attention[0].sentence).toMatch(/4 values/)
    expect(r.attention[0].href).toBe('/review')
  })

  it('raises a value more than half away from the trailing four-period mean', () => {
    const history = [
      rec({ id: 'a', value: 100, periodStart: '2025-07-01', periodEnd: '2025-09-30' }),
      rec({ id: 'b', value: 100, periodStart: '2025-10-01', periodEnd: '2025-12-31' }),
      rec({ id: 'c', value: 100, periodStart: '2026-01-01', periodEnd: '2026-03-31' }),
      rec({ id: 'd', value: 100, periodStart: '2026-04-01', periodEnd: '2026-06-30' }),
    ]
    const steady = buildAttention(input({ records: [...history, rec({ id: 'e', value: 120 })] }))
    expect(steady.attention.filter(i => i.key.startsWith('outlier'))).toHaveLength(0)

    const spike = buildAttention(input({ records: [...history, rec({ id: 'e', value: 400 })] }))
    expect(spike.attention.filter(i => i.key.startsWith('outlier'))).toHaveLength(1)
  })
})

describe('ordering and shape', () => {
  it('sorts blocking items by deadline, soonest first', () => {
    const r = buildAttention(input({
      now: new Date('2026-09-20T00:00:00Z'),
      records: [rec({ periodStart: '2026-04-01', periodEnd: '2026-06-30' })],
      documents: [{ id: 'd2', fileName: 'broken.pdf', status: 'REJECTED', errorMessage: 'unreadable' }],
    }))
    // The closing period has a date; a failed upload has none, so it follows.
    expect(r.blocking[0].deadline).not.toBeNull()
    expect(r.blocking[r.blocking.length - 1].deadline).toBeNull()
  })

  it('gives every item a sentence, an action and a unique key', () => {
    const r = buildAttention(input({
      documents: [
        { id: 'd1', fileName: 'q3.pdf', status: 'REVIEW_REQUIRED', valueCount: 4 },
        { id: 'd2', fileName: 'broken.pdf', status: 'REJECTED', errorMessage: 'unreadable' },
      ],
      unitConflicts: [{ recordId: 'r9', domain: 'ENERGY', fieldName: 'total_consumption_kwh', unit: 'kWh', expected: 'mj' }],
    }))
    const all = [...r.blocking, ...r.attention]
    expect(new Set(all.map(i => i.key)).size).toBe(all.length)
    for (const item of all) {
      expect(item.sentence.length).toBeGreaterThan(0)
      expect(item.actionLabel.length).toBeGreaterThan(0)
      expect(item.href.startsWith('/')).toBe(true)
    }
  })
})
