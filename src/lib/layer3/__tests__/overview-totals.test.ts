// Layer 3 — §5. Four figures for the declaration year.
//
// Two rules do all the work. Nothing is summed across units, because arbor does
// not convert; a disagreement is counted and shown, not resolved. And every
// figure carries the weakest tier behind it, so a total can never look more
// certain than its softest record.

import { buildOverviewTotals, type TotalRecord } from '../overview-totals'

const rec = (o: Partial<TotalRecord> = {}): TotalRecord => ({
  id: 'r1',
  domain: 'ENERGY',
  fieldName: 'total_consumption_kwh',
  value: 100,
  unit: 'mj',
  trustTier: 'A',
  periodEnd: '2026-03-31',
  ...o,
})

const totals = (records: TotalRecord[], year = 2026) => buildOverviewTotals(records, year)
const byKey = (records: TotalRecord[], key: string) =>
  totals(records).find(t => t.key === key)!

describe('buildOverviewTotals', () => {
  it('always returns the same four figures, in order', () => {
    expect(totals([]).map(t => t.key)).toEqual(['energy', 'weight', 'materials', 'emissions'])
  })

  it('sums records of one field recorded in one unit', () => {
    const energy = byKey([rec({ id: 'a', value: 100 }), rec({ id: 'b', value: 250 })], 'energy')
    expect(energy.value).toBe(350)
    expect(energy.unit).toBe('mj')
    expect(energy.recordIds).toEqual(['a', 'b'])
  })

  it('excludes records outside the declaration year', () => {
    const energy = byKey([rec({ value: 100 }), rec({ value: 999, periodEnd: '2025-12-31' })], 'energy')
    expect(energy.value).toBe(100)
  })

  it('refuses to sum across units, and counts the conflict instead', () => {
    // Adding MJ to kWh needs a conversion. arbor does not convert, so the
    // honest output is the majority unit plus a visible conflict count.
    const energy = byKey([
      rec({ id: 'a', value: 100, unit: 'mj' }),
      rec({ id: 'b', value: 200, unit: 'mj' }),
      rec({ id: 'c', value: 5, unit: 'kWh' }),
    ], 'energy')
    expect(energy.value).toBe(300)
    expect(energy.unit).toBe('mj')
    expect(energy.conflictCount).toBe(1)
  })

  it('carries the weakest tier behind the figure', () => {
    const energy = byKey([rec({ trustTier: 'A' }), rec({ trustTier: 'C' })], 'energy')
    expect(energy.tier).toBe('C')
  })

  it('renders no figure at all rather than a zero when nothing was recorded', () => {
    const energy = byKey([], 'energy')
    expect(energy.value).toBeNull()
    expect(energy.tier).toBeNull()
  })

  it('always treats total emissions as a placeholder, never a number', () => {
    // arbor stores declared figures; it does not compute a footprint. Rendering
    // a partial sum here would be the one number on the page nobody could trace.
    const emissions = byKey([
      rec({ domain: 'EMISSIONS', fieldName: 'total_co2e_kg', unit: 'kg', value: 412000 }),
    ], 'emissions')
    expect(emissions.value).toBeNull()
    expect(emissions.placeholderReason).toBeTruthy()
  })

  it('names what the emissions figure is missing', () => {
    const emissions = byKey([rec()], 'emissions')
    expect(emissions.placeholderReason).toMatch(/emission factor/i)
  })

  it('routes each record type to its own figure', () => {
    const rows = totals([
      rec({ domain: 'ENERGY', fieldName: 'total_consumption_kwh', value: 10, unit: 'mj' }),
      rec({ domain: 'LOGISTICS', fieldName: 'shipment_weight', value: 20, unit: 'kg' }),
      rec({ domain: 'MATERIALS', fieldName: 'quantity', value: 30, unit: 'kg' }),
    ])
    expect(rows.find(t => t.key === 'energy')!.value).toBe(10)
    expect(rows.find(t => t.key === 'weight')!.value).toBe(20)
    expect(rows.find(t => t.key === 'materials')!.value).toBe(30)
  })

  it('keeps every figure traceable to record ids', () => {
    for (const total of totals([rec({ id: 'x' })])) {
      if (total.value !== null) expect(total.recordIds.length).toBeGreaterThan(0)
    }
  })
})
