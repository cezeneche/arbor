import { buildScope3Inventory, type Scope3Input } from '../inventory'

// [GHG Protocol Scope 3 Standard — all fifteen categories]
const EMPTY_FACTORS: Scope3Input['emissionFactors'] = []

function makeRecord(
  id: string,
  scope3Category: number | null,
  value: number,
  trustTier: 'A' | 'B' | 'C',
  domain = 'ENERGY',
  fieldName = 'total_consumption_kwh',
  unit = 'kWh',
): Scope3Input['records'][0] {
  return { id, domain, scope3Category, fieldName, value, unit, trustTier, extractionMethod: 'AI_EXTRACTED' }
}

describe('buildScope3Inventory @regulatory', () => {
  // [GHG Protocol Scope 3 Standard §7.1] records with null scope3Category are excluded
  it('records with null scope3Category are excluded from inventory', () => {
    const input: Scope3Input = {
      records: [makeRecord('r1', null, 100, 'A')],
      emissionFactors: EMPTY_FACTORS,
    }
    const result = buildScope3Inventory(input)
    expect(result.categories).toHaveLength(0)
    expect(result.totalKgCo2e).toBe(0)
  })

  it('single record without matching factor → co2e 0, still included in category', () => {
    const input: Scope3Input = {
      records: [makeRecord('r1', 1, 500, 'A')],
      emissionFactors: EMPTY_FACTORS,
    }
    const result = buildScope3Inventory(input)
    expect(result.categories).toHaveLength(1)
    expect(result.categories[0].category).toBe(1)
    expect(result.categories[0].totalKgCo2e).toBe(0)
    expect(result.categories[0].recordCount).toBe(1)
  })

  it('applies emission factor and calculates co2e correctly', () => {
    const input: Scope3Input = {
      records: [makeRecord('r1', 1, 1000, 'A', 'ENERGY', 'total_consumption_kwh', 'kWh')],
      emissionFactors: [{
        activityType: 'ENERGY_total_consumption_kwh',
        factor: 0.000233,
        unit: 'tCO2e/kWh',
        source: 'DEFRA 2024',
        version: '2024',
        citation: 'DEFRA 2024 Grid electricity',
      }],
    }
    const result = buildScope3Inventory(input)
    expect(result.categories[0].totalKgCo2e).toBeGreaterThan(0)
  })

  // [GHG Protocol Scope 3 Standard §5.3] coverage report: categories 1-15 always present
  it('all 15 categories accounted for in coverage report', () => {
    const input: Scope3Input = {
      records: [makeRecord('r1', 1, 100, 'A')],
      emissionFactors: EMPTY_FACTORS,
    }
    const result = buildScope3Inventory(input)
    const allCovered = [
      ...result.coverageReport.fullyDataComplete,
      ...result.coverageReport.partiallyEstimated,
      ...result.coverageReport.notCovered,
    ].sort((a, b) => a - b)
    expect(allCovered).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
  })

  // [GHG Protocol Scope 3 Standard §5.3] category is dataComplete when no Tier C records
  it('category with only Tier A/B records is dataComplete', () => {
    const input: Scope3Input = {
      records: [makeRecord('r1', 5, 100, 'A'), makeRecord('r2', 5, 200, 'B')],
      emissionFactors: EMPTY_FACTORS,
    }
    const result = buildScope3Inventory(input)
    const cat = result.categories.find(c => c.category === 5)!
    expect(cat.dataComplete).toBe(true)
    expect(result.coverageReport.fullyDataComplete).toContain(5)
  })

  // [GHG Protocol Scope 3 Standard §5.3] category with Tier C records is partially estimated
  it('category with Tier C records is NOT dataComplete', () => {
    const input: Scope3Input = {
      records: [makeRecord('r1', 5, 100, 'C')],
      emissionFactors: EMPTY_FACTORS,
    }
    const result = buildScope3Inventory(input)
    const cat = result.categories.find(c => c.category === 5)!
    expect(cat.dataComplete).toBe(false)
    expect(result.coverageReport.partiallyEstimated).toContain(5)
  })

  // [GHG Protocol Scope 3 Standard §5.4] mixed-method category when multiple trust tiers present
  it('category with mixed Tier A and C is isMixedMethod', () => {
    const input: Scope3Input = {
      records: [makeRecord('r1', 3, 100, 'A'), makeRecord('r2', 3, 200, 'C')],
      emissionFactors: EMPTY_FACTORS,
    }
    const result = buildScope3Inventory(input)
    const cat = result.categories.find(c => c.category === 3)!
    expect(cat.isMixedMethod).toBe(true)
    expect(result.mixedMethodCategories).toContain(3)
  })

  it('single-tier category is not isMixedMethod', () => {
    const input: Scope3Input = {
      records: [makeRecord('r1', 3, 100, 'A'), makeRecord('r2', 3, 200, 'A')],
      emissionFactors: EMPTY_FACTORS,
    }
    const result = buildScope3Inventory(input)
    const cat = result.categories.find(c => c.category === 3)!
    expect(cat.isMixedMethod).toBe(false)
  })

  // [GHG Protocol Scope 3 Standard] totalKgCo2e is sum of all categories
  it('totalKgCo2e is the sum across all categories', () => {
    const input: Scope3Input = {
      records: [
        makeRecord('r1', 1, 1000, 'A', 'ENERGY', 'total_consumption_kwh', 'kWh'),
        makeRecord('r2', 4, 500, 'B', 'ENERGY', 'total_consumption_kwh', 'kWh'),
      ],
      emissionFactors: [{
        activityType: 'ENERGY_total_consumption_kwh',
        factor: 0.000233,
        unit: 'tCO2e/kWh',
        source: 'DEFRA 2024',
        version: '2024',
        citation: 'DEFRA 2024 Grid electricity',
      }],
    }
    const result = buildScope3Inventory(input)
    const sumFromCategories = result.categories.reduce((s, c) => s + c.totalKgCo2e, 0)
    expect(result.totalKgCo2e).toBeCloseTo(sumFromCategories, 10)
  })

  it('empty records → zero total, all 15 categories in notCovered', () => {
    const result = buildScope3Inventory({ records: [], emissionFactors: [] })
    expect(result.totalKgCo2e).toBe(0)
    expect(result.coverageReport.notCovered).toHaveLength(15)
    expect(result.coverageReport.fullyDataComplete).toHaveLength(0)
  })

  it('is a pure function — same inputs always return same outputs', () => {
    const input: Scope3Input = {
      records: [makeRecord('r1', 1, 100, 'A')],
      emissionFactors: EMPTY_FACTORS,
    }
    const a = buildScope3Inventory(input)
    const b = buildScope3Inventory(input)
    expect(a.totalKgCo2e).toBe(b.totalKgCo2e)
    expect(a.coverageReport.notCovered.length).toBe(b.coverageReport.notCovered.length)
  })
})
