import { buildGri305Disclosure } from '../gri-305'
import type { Scope3InventoryResult } from '@/lib/scope3/inventory'

const emptyScope3: Scope3InventoryResult = {
  categories: [],
  totalKgCo2e: 0,
  coverageReport: { fullyDataComplete: [], partiallyEstimated: [], notCovered: [] },
  mixedMethodCategories: [],
  gapClosePathway: [],
}

const scope3WithCats: Scope3InventoryResult = {
  ...emptyScope3,
  totalKgCo2e: 5000,
  categories: [
    { category: 1, name: 'Purchased goods and materials', totalKgCo2e: 3000, byTier: { A: 3000, B: 0, C: 0 }, recordCount: 5, isMixedMethod: false, dataComplete: true, lineItems: [] },
    { category: 4, name: 'Upstream transport', totalKgCo2e: 2000, byTier: { A: 0, B: 2000, C: 0 }, recordCount: 3, isMixedMethod: false, dataComplete: false, lineItems: [] },
  ],
}

describe('buildGri305Disclosure — @regulatory', () => {
  it('sets the correct standard and regulatory reference', () => {
    const d = buildGri305Disclosure({ entityName: 'Test Co', reportingYear: 2026, scope1Records: [], scope2Records: [], scope3Inventory: emptyScope3 })
    expect(d.standard).toBe('GRI 305')
    expect(d.regulatoryReference).toContain('GRI 305')
  })

  it('maps scope 1 records to GRI 305-1', () => {
    const scope1 = [{ id: 's1', fieldName: 'process_emissions', value: 1200, unit: 'kg CO2e', trustTier: 'A' as const }]
    const d = buildGri305Disclosure({ entityName: 'Test Co', reportingYear: 2026, scope1Records: scope1, scope2Records: [], scope3Inventory: emptyScope3 })
    expect(d.gri305_1.totalKgCo2e).toBe(1200)
    expect(d.gri305_1.trustTier).toBe('A')
    expect(d.gri305_1.lineItems).toHaveLength(1)
  })

  it('maps scope 2 records to GRI 305-2', () => {
    const scope2 = [{ id: 's2', fieldName: 'purchased_electricity', value: 800, unit: 'kg CO2e', trustTier: 'B' as const }]
    const d = buildGri305Disclosure({ entityName: 'Test Co', reportingYear: 2026, scope1Records: [], scope2Records: scope2, scope3Inventory: emptyScope3 })
    expect(d.gri305_2.totalKgCo2e).toBe(800)
    expect(d.gri305_2.trustTier).toBe('B')
  })

  it('maps scope 3 inventory to GRI 305-3 with category breakdown', () => {
    const d = buildGri305Disclosure({ entityName: 'Test Co', reportingYear: 2026, scope1Records: [], scope2Records: [], scope3Inventory: scope3WithCats })
    expect(d.gri305_3.totalKgCo2e).toBe(5000)
    expect(d.gri305_3.byCategory).toHaveLength(2)
    expect(d.gri305_3.byCategory[0].category).toBe(1)
    expect(d.gri305_3.byCategory[0].trustTier).toBe('A')
    expect(d.gri305_3.byCategory[1].trustTier).toBe('B')
  })

  it('propagates trust tier: scope 1 tier A, scope 2 tier B → scope 2 gets tier B', () => {
    const scope1 = [{ id: 's1', fieldName: 'f1', value: 100, unit: 'kg CO2e', trustTier: 'A' as const }]
    const scope2 = [{ id: 's2', fieldName: 'f2', value: 200, unit: 'kg CO2e', trustTier: 'B' as const }]
    const d = buildGri305Disclosure({ entityName: 'T', reportingYear: 2026, scope1Records: scope1, scope2Records: scope2, scope3Inventory: emptyScope3 })
    expect(d.gri305_1.trustTier).toBe('A')
    expect(d.gri305_2.trustTier).toBe('B')
  })

  it('omits GRI 305-4 when no denominator is provided', () => {
    const d = buildGri305Disclosure({ entityName: 'T', reportingYear: 2026, scope1Records: [], scope2Records: [], scope3Inventory: emptyScope3 })
    expect(d.gri305_4).toBeUndefined()
  })

  it('computes GRI 305-4 intensity when denominator is provided', () => {
    const scope1 = [{ id: 's1', fieldName: 'f', value: 1000, unit: 'kg CO2e', trustTier: 'A' as const }]
    const d = buildGri305Disclosure({
      entityName: 'T', reportingYear: 2026,
      scope1Records: scope1, scope2Records: [],
      scope3Inventory: emptyScope3,
      emissionIntensityDenominator: { value: 500, unit: 'tonnes produced', trustTier: 'A' },
    })
    expect(d.gri305_4).toBeDefined()
    expect(d.gri305_4!.ratioKgCo2ePerUnit).toBeCloseTo(2)
    expect(d.gri305_4!.denominatorUnit).toBe('tonnes produced')
  })

  it('returns 0 intensity when denominator is zero', () => {
    const scope1 = [{ id: 's1', fieldName: 'f', value: 1000, unit: 'kg CO2e', trustTier: 'A' as const }]
    const d = buildGri305Disclosure({
      entityName: 'T', reportingYear: 2026,
      scope1Records: scope1, scope2Records: [],
      scope3Inventory: emptyScope3,
      emissionIntensityDenominator: { value: 0, unit: 'units', trustTier: 'A' },
    })
    expect(d.gri305_4!.ratioKgCo2ePerUnit).toBe(0)
  })
})
