import { buildCdpClimateDisclosure } from '../cdp-climate'
import type { Scope3InventoryResult } from '@/lib/scope3/inventory'

const emptyScope3: Scope3InventoryResult = {
  categories: [],
  totalKgCo2e: 0,
  coverageReport: { fullyDataComplete: [], partiallyEstimated: [], notCovered: [] },
  mixedMethodCategories: [],
  gapClosePathway: [],
}

const scope3WithMix: Scope3InventoryResult = {
  ...emptyScope3,
  totalKgCo2e: 8000,
  categories: [
    { category: 1, name: 'Purchased goods', totalKgCo2e: 6000, byTier: { A: 6000, B: 0, C: 0 }, recordCount: 4, isMixedMethod: false, dataComplete: true, lineItems: [] },
    { category: 3, name: 'Fuel and energy', totalKgCo2e: 2000, byTier: { A: 0, B: 0, C: 2000 }, recordCount: 2, isMixedMethod: false, dataComplete: false, lineItems: [] },
  ],
}

describe('buildCdpClimateDisclosure — @regulatory', () => {
  it('identifies as CDP Climate Change questionnaire', () => {
    const d = buildCdpClimateDisclosure({ entityName: 'T', reportingYear: 2026, scope1KgCo2e: 0, scope1TrustTier: 'A', scope2LocationBasedKgCo2e: 0, scope2TrustTier: 'A', scope3Inventory: emptyScope3 })
    expect(d.questionnaire).toBe('CDP Climate Change')
    expect(d.regulatoryReference).toContain('C6')
  })

  it('maps scope 1 to C6.1', () => {
    const d = buildCdpClimateDisclosure({ entityName: 'T', reportingYear: 2026, scope1KgCo2e: 1500, scope1TrustTier: 'A', scope2LocationBasedKgCo2e: 0, scope2TrustTier: 'A', scope3Inventory: emptyScope3 })
    expect(d.c6_1.grossScope1KgCo2e).toBe(1500)
    expect(d.c6_1.trustTier).toBe('A')
    expect(d.c6_1.dataQuality).toBe('Third-party verified')
  })

  it('maps scope 2 to C6.3', () => {
    const d = buildCdpClimateDisclosure({ entityName: 'T', reportingYear: 2026, scope1KgCo2e: 0, scope1TrustTier: 'A', scope2LocationBasedKgCo2e: 900, scope2TrustTier: 'B', scope3Inventory: emptyScope3 })
    expect(d.c6_3.grossScope2LocationBasedKgCo2e).toBe(900)
    expect(d.c6_3.trustTier).toBe('B')
    expect(d.c6_3.dataQuality).toBe('Reported')
  })

  it('maps scope 3 categories to C6.5', () => {
    const d = buildCdpClimateDisclosure({ entityName: 'T', reportingYear: 2026, scope1KgCo2e: 0, scope1TrustTier: 'A', scope2LocationBasedKgCo2e: 0, scope2TrustTier: 'A', scope3Inventory: scope3WithMix })
    expect(d.c6_5.totalScope3KgCo2e).toBe(8000)
    expect(d.c6_5.categories).toHaveLength(2)
    expect(d.c6_5.categories[0].trustTier).toBe('A')
    expect(d.c6_5.categories[0].dataQuality).toBe('Third-party verified')
    expect(d.c6_5.categories[1].trustTier).toBe('C')
    expect(d.c6_5.categories[1].dataQuality).toBe('Estimated')
  })

  it('sets overallTrustTier to the lowest tier across all scopes', () => {
    const d = buildCdpClimateDisclosure({ entityName: 'T', reportingYear: 2026, scope1KgCo2e: 100, scope1TrustTier: 'A', scope2LocationBasedKgCo2e: 50, scope2TrustTier: 'A', scope3Inventory: scope3WithMix })
    expect(d.overallTrustTier).toBe('C') // scope 3 has Tier C category
  })

  it('sets overallTrustTier to A when all inputs are Tier A', () => {
    const allTierAScope3: Scope3InventoryResult = {
      ...emptyScope3,
      totalKgCo2e: 1000,
      categories: [{ category: 1, name: 'Cat 1', totalKgCo2e: 1000, byTier: { A: 1000, B: 0, C: 0 }, recordCount: 3, isMixedMethod: false, dataComplete: true, lineItems: [] }],
    }
    const d = buildCdpClimateDisclosure({ entityName: 'T', reportingYear: 2026, scope1KgCo2e: 100, scope1TrustTier: 'A', scope2LocationBasedKgCo2e: 50, scope2TrustTier: 'A', scope3Inventory: allTierAScope3 })
    expect(d.overallTrustTier).toBe('A')
  })

  it('uses Tier C as scope3 tier when no categories exist', () => {
    const d = buildCdpClimateDisclosure({ entityName: 'T', reportingYear: 2026, scope1KgCo2e: 0, scope1TrustTier: 'A', scope2LocationBasedKgCo2e: 0, scope2TrustTier: 'A', scope3Inventory: emptyScope3 })
    expect(d.c6_5.trustTier).toBe('C')
  })
})
