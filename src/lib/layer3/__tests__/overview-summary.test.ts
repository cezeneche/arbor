// Layer 3 — the headline figures a company sees on its Overview.
//
// This is a roll-up of stored records, not a calculation: it adds like to like
// (same field, same unit, same reporting year) and refuses to combine anything
// that would need a factor, a formula, or a unit conversion to combine. The
// answer is always "this is what your documents say", never a derived metric.

import { summariseOperationalPosition, type PositionRecord } from '../overview-summary'

const rec = (over: Partial<PositionRecord> = {}): PositionRecord => ({
  domain: 'ENERGY',
  fieldName: 'total_consumption_kwh',
  value: 100,
  unit: 'kWh',
  trustTier: 'A',
  periodStart: new Date('2026-01-01'),
  periodEnd: new Date('2026-03-31'),
  ...over,
})

describe('summariseOperationalPosition', () => {
  it('returns an empty position when there are no records', () => {
    const summary = summariseOperationalPosition([])
    expect(summary.reportingYear).toBeNull()
    expect(summary.headlines).toEqual([])
    expect(summary.recordsInPeriod).toBe(0)
    expect(summary.coveredDomains).toEqual([])
  })

  it('reports the calendar year of the most recent record as the reporting year', () => {
    const summary = summariseOperationalPosition([
      rec({ periodEnd: new Date('2024-12-31') }),
      rec({ periodEnd: new Date('2026-06-30') }),
    ])
    expect(summary.reportingYear).toBe(2026)
  })

  it('adds records of the same field and unit within the reporting year', () => {
    const summary = summariseOperationalPosition([
      rec({ value: 1200, periodEnd: new Date('2026-03-31') }),
      rec({ value: 800, periodEnd: new Date('2026-06-30') }),
    ])
    const energy = summary.headlines.find(h => h.fieldName === 'total_consumption_kwh')!
    expect(energy.total).toBe(2000)
    expect(energy.unit).toBe('kWh')
    expect(energy.recordCount).toBe(2)
  })

  it('excludes records from earlier years from the headline figure', () => {
    const summary = summariseOperationalPosition([
      rec({ value: 5000, periodEnd: new Date('2025-12-31') }),
      rec({ value: 300, periodEnd: new Date('2026-01-31') }),
    ])
    const energy = summary.headlines.find(h => h.fieldName === 'total_consumption_kwh')!
    expect(energy.total).toBe(300)
    expect(summary.recordsInPeriod).toBe(1)
  })

  it('never adds two different units together — each unit gets its own figure', () => {
    // Adding m³ to kWh would need a calorific value. That is a calculation, and
    // arbor does not calculate. Two honest rows beat one wrong number.
    const summary = summariseOperationalPosition([
      rec({ value: 100, unit: 'kWh' }),
      rec({ value: 40, unit: 'm3' }),
    ])
    const units = summary.headlines
      .filter(h => h.fieldName === 'total_consumption_kwh')
      .map(h => h.unit)
      .sort()
    expect(units).toEqual(['kWh', 'm3'])
  })

  it('carries the honest composed tier of every figure it shows', () => {
    // One Declared record among Verified ones makes the whole figure Declared.
    const summary = summariseOperationalPosition([
      rec({ value: 10, trustTier: 'A' }),
      rec({ value: 10, trustTier: 'B' }),
    ])
    const energy = summary.headlines[0]
    expect(energy.tierComposition.meet).toBe('B')
    expect(energy.tierComposition.counts).toEqual({ A: 1, B: 1, C: 0 })
  })

  it('surfaces declared emissions ahead of other domains', () => {
    // "What are our emissions" is the question buyers ask first, so the figure
    // companies are asked for most often leads.
    const summary = summariseOperationalPosition([
      rec({ domain: 'LOGISTICS', fieldName: 'shipment_weight', unit: 'kg' }),
      rec({ domain: 'EMISSIONS', fieldName: 'total_co2e_kg', unit: 'kg' }),
      rec({ domain: 'ENERGY' }),
    ])
    expect(summary.headlines[0].domain).toBe('EMISSIONS')
    expect(summary.headlines[1].domain).toBe('ENERGY')
  })

  it('labels every figure in plain English with no underscores', () => {
    const summary = summariseOperationalPosition([rec()])
    for (const h of summary.headlines) {
      expect(h.label).not.toMatch(/_/)
      expect(h.domainLabel).toBeTruthy()
    }
  })

  it('reports which domains have data this year and which do not', () => {
    const summary = summariseOperationalPosition([
      rec({ domain: 'ENERGY' }),
      rec({ domain: 'PRODUCTION', fieldName: 'quantity_produced', unit: 'kg' }),
    ])
    expect(summary.coveredDomains.sort()).toEqual(['ENERGY', 'PRODUCTION'])
    expect(summary.missingDomains).toContain('EMISSIONS')
    expect(summary.missingDomains).not.toContain('ENERGY')
    expect(summary.coveredDomains.length + summary.missingDomains.length).toBe(8)
  })

  it('ignores records whose value is not a usable number', () => {
    const summary = summariseOperationalPosition([
      rec({ value: 100 }),
      rec({ value: Number.NaN }),
    ])
    expect(summary.headlines[0].total).toBe(100)
    expect(summary.headlines[0].recordCount).toBe(1)
  })
})
