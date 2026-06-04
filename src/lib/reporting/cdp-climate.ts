// Layer 3 — packaging only. No calculation logic. Translation of existing records.
// [CDP Climate Change Questionnaire — Section C6: Emissions data]
// Trust tier propagates as a data quality flag on every section.

import type { Scope3InventoryResult } from '@/lib/scope3/inventory'

export type CdpDataQuality = 'Third-party verified' | 'Reported' | 'Estimated'

function tierToDataQuality(tier: 'A' | 'B' | 'C'): CdpDataQuality {
  if (tier === 'A') return 'Third-party verified'
  if (tier === 'B') return 'Reported'
  return 'Estimated'
}

function lowestTier(tiers: Array<'A' | 'B' | 'C'>): 'A' | 'B' | 'C' {
  if (tiers.includes('C')) return 'C'
  if (tiers.includes('B')) return 'B'
  return 'A'
}

export interface CdpScope3Category {
  category: number
  name: string
  totalKgCo2e: number
  dataQuality: CdpDataQuality
  trustTier: 'A' | 'B' | 'C'
}

export interface CdpClimateDisclosure {
  questionnaire: 'CDP Climate Change'
  reportingYear: number
  entityName: string
  regulatoryReference: string
  // C6.1 — Gross global Scope 1 emissions
  c6_1: {
    grossScope1KgCo2e: number
    trustTier: 'A' | 'B' | 'C'
    dataQuality: CdpDataQuality
  }
  // C6.3 — Gross global Scope 2 emissions (location-based)
  c6_3: {
    grossScope2LocationBasedKgCo2e: number
    trustTier: 'A' | 'B' | 'C'
    dataQuality: CdpDataQuality
  }
  // C6.5 — Gross global Scope 3 emissions by category
  c6_5: {
    totalScope3KgCo2e: number
    trustTier: 'A' | 'B' | 'C'
    dataQuality: CdpDataQuality
    categories: CdpScope3Category[]
  }
  overallTrustTier: 'A' | 'B' | 'C'
}

// [CDP C6.1] Gross Scope 1 GHG emissions
// [CDP C6.3] Gross Scope 2 GHG emissions (location-based)
// [CDP C6.5] Gross Scope 3 GHG emissions and categories
export function buildCdpClimateDisclosure(input: {
  entityName: string
  reportingYear: number
  scope1KgCo2e: number
  scope1TrustTier: 'A' | 'B' | 'C'
  scope2LocationBasedKgCo2e: number
  scope2TrustTier: 'A' | 'B' | 'C'
  scope3Inventory: Scope3InventoryResult
}): CdpClimateDisclosure {
  const scope3Categories: CdpScope3Category[] = input.scope3Inventory.categories.map(cat => {
    const tier = lowestTier(
      (['A', 'B', 'C'] as const).filter(t => cat.byTier[t] > 0),
    ) as 'A' | 'B' | 'C'
    return {
      category: cat.category,
      name: cat.name,
      totalKgCo2e: cat.totalKgCo2e,
      trustTier: tier,
      dataQuality: tierToDataQuality(tier),
    }
  })

  const scope3Tier = scope3Categories.length > 0
    ? lowestTier(scope3Categories.map(c => c.trustTier))
    : 'C'

  const overallTier = lowestTier([input.scope1TrustTier, input.scope2TrustTier, scope3Tier])

  return {
    questionnaire: 'CDP Climate Change',
    reportingYear: input.reportingYear,
    entityName: input.entityName,
    regulatoryReference: 'CDP Climate Change Questionnaire 2024, Section C6: Emissions data',
    c6_1: {
      grossScope1KgCo2e: input.scope1KgCo2e,
      trustTier: input.scope1TrustTier,
      dataQuality: tierToDataQuality(input.scope1TrustTier),
    },
    c6_3: {
      grossScope2LocationBasedKgCo2e: input.scope2LocationBasedKgCo2e,
      trustTier: input.scope2TrustTier,
      dataQuality: tierToDataQuality(input.scope2TrustTier),
    },
    c6_5: {
      totalScope3KgCo2e: input.scope3Inventory.totalKgCo2e,
      trustTier: scope3Tier,
      dataQuality: tierToDataQuality(scope3Tier),
      categories: scope3Categories,
    },
    overallTrustTier: overallTier,
  }
}
