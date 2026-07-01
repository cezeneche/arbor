import {
  validateAnonymisation,
  computeSectorBenchmarks,
  benchmarkPercentileRank,
  BENCHMARK_MIN_ENTITIES,
} from '../sector-benchmark'

function makeRecords(entityCount: number, value = 100): import('../sector-benchmark').BenchmarkRecord[] {
  return Array.from({ length: entityCount }, (_, i) => ({
    entityId: `entity-${i}`,
    sector: 'steel',
    domain: 'ENERGY',
    fieldName: 'electricity_kwh',
    value,
    unit: 'kWh',
    trustTier: 'A' as const,
  }))
}

describe('validateAnonymisation', () => {
  it('rejects entity counts below the minimum threshold', () => {
    expect(validateAnonymisation(9)).toBe(false)
    expect(validateAnonymisation(BENCHMARK_MIN_ENTITIES - 1)).toBe(false)
  })

  it('accepts entity counts at or above the minimum threshold', () => {
    expect(validateAnonymisation(10)).toBe(true)
    expect(validateAnonymisation(100)).toBe(true)
  })

  it('respects a custom threshold', () => {
    expect(validateAnonymisation(5, 5)).toBe(true)
    expect(validateAnonymisation(4, 5)).toBe(false)
  })
})

describe('computeSectorBenchmarks', () => {
  it('returns no results when fewer than 10 entities contribute', () => {
    const records = makeRecords(9)
    const results = computeSectorBenchmarks({ records, year: 2026 })
    expect(results).toHaveLength(0)
  })

  it('returns a result when 10 or more entities contribute', () => {
    const records = makeRecords(10, 50)
    const results = computeSectorBenchmarks({ records, year: 2026 })
    expect(results).toHaveLength(1)
    expect(results[0].entityCount).toBe(10)
  })

  it('computes correct min/max/mean for uniform values', () => {
    const records = makeRecords(10, 100)
    const [r] = computeSectorBenchmarks({ records, year: 2026 })
    expect(r.minValue).toBe(100)
    expect(r.maxValue).toBe(100)
    expect(r.meanValue).toBe(100)
    expect(r.medianValue).toBe(100)
    expect(r.stddevValue).toBe(0)
  })

  it('computes correct stats for a range of values', () => {
    const records = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v, i) => ({
      entityId: `e${i}`,
      sector: 'steel',
      domain: 'ENERGY',
      fieldName: 'electricity_kwh',
      value: v,
      unit: 'kWh',
      trustTier: 'A' as const,
    }))
    const [r] = computeSectorBenchmarks({ records, year: 2026 })
    expect(r.minValue).toBe(10)
    expect(r.maxValue).toBe(100)
    expect(r.meanValue).toBe(55)
    expect(r.medianValue).toBe(55)
  })

  it('groups by sector+domain+fieldName correctly', () => {
    const energyRecords = makeRecords(10, 100)
    const materialRecords = makeRecords(10, 200).map(r => ({
      ...r,
      entityId: `mat-${r.entityId}`,
      fieldName: 'material_kg',
    }))
    const results = computeSectorBenchmarks({ records: [...energyRecords, ...materialRecords], year: 2026 })
    expect(results).toHaveLength(2)
  })

  it('averages multiple records from the same entity before computing stats', () => {
    // 9 entities with value 100, 1 entity with two records averaging to 100
    const records = makeRecords(9, 100)
    const doubleEntity = [
      { entityId: 'entity-double', sector: 'steel', domain: 'ENERGY', fieldName: 'electricity_kwh', value: 80, unit: 'kWh', trustTier: 'A' as const },
      { entityId: 'entity-double', sector: 'steel', domain: 'ENERGY', fieldName: 'electricity_kwh', value: 120, unit: 'kWh', trustTier: 'A' as const },
    ]
    const [r] = computeSectorBenchmarks({ records: [...records, ...doubleEntity], year: 2026 })
    expect(r.entityCount).toBe(10)
    expect(r.meanValue).toBe(100)
  })

  it('computes tierAPercent correctly', () => {
    const tierARecords = makeRecords(8, 100)
    const tierBRecords = makeRecords(2, 100).map((r, i) => ({
      ...r,
      entityId: `tier-b-${i}`,
      trustTier: 'B' as const,
    }))
    const [r] = computeSectorBenchmarks({ records: [...tierARecords, ...tierBRecords], year: 2026 })
    expect(r.tierAPercent).toBe(80)
  })

  it('carries the lattice tier composition for the benchmark aggregate (Upgrade 6)', () => {
    const tierARecords = makeRecords(8, 100)
    const tierBRecords = makeRecords(2, 100).map((r, i) => ({
      ...r,
      entityId: `tier-b-${i}`,
      trustTier: 'B' as const,
    }))
    const [r] = computeSectorBenchmarks({ records: [...tierARecords, ...tierBRecords], year: 2026 })
    // Meet is the weakest member present — one Declared record drags it to B.
    expect(r.tierComposition.meet).toBe('B')
    expect(r.tierComposition.counts).toEqual({ A: 8, B: 2, C: 0 })
    expect(r.tierComposition.distribution.A).toBeCloseTo(0.8, 10)
  })

  it('attaches the correct year to results', () => {
    const [r] = computeSectorBenchmarks({ records: makeRecords(10), year: 2027 })
    expect(r.year).toBe(2027)
  })
})

describe('benchmarkPercentileRank', () => {
  const benchmark = { minValue: 0, maxValue: 100 }

  it('returns 0 for the minimum value', () => {
    expect(benchmarkPercentileRank(0, benchmark)).toBe(0)
  })

  it('returns 100 for the maximum value', () => {
    expect(benchmarkPercentileRank(100, benchmark)).toBe(100)
  })

  it('returns 50 for the midpoint', () => {
    expect(benchmarkPercentileRank(50, benchmark)).toBe(50)
  })

  it('returns 50 when min equals max (no range)', () => {
    expect(benchmarkPercentileRank(75, { minValue: 75, maxValue: 75 })).toBe(50)
  })

  it('clamps values outside the range', () => {
    expect(benchmarkPercentileRank(-10, benchmark)).toBe(0)
    expect(benchmarkPercentileRank(110, benchmark)).toBe(100)
  })
})
