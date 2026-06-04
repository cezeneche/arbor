// Layer 3 — packaging only. No calculation logic. Translation of existing records.
// [GRI 305: Emissions 2016]
// Trust tier propagates to every line item in the disclosure.

import type { Scope3InventoryResult } from '@/lib/scope3/inventory'

export interface Gri305InputRecord {
  id: string
  fieldName: string
  value: number
  unit: string
  trustTier: 'A' | 'B' | 'C'
}

export interface Gri305LineItem {
  recordId: string
  fieldName: string
  value: number
  unit: string
  trustTier: 'A' | 'B' | 'C'
}

export interface Gri305Intensity {
  ratioKgCo2ePerUnit: number
  denominatorValue: number
  denominatorUnit: string
  trustTier: 'A' | 'B' | 'C'
}

export interface Gri305Disclosure {
  standard: 'GRI 305'
  version: '2016'
  regulatoryReference: string
  entityName: string
  reportingYear: number
  gri305_1: {
    label: 'Gross direct (Scope 1) GHG emissions'
    totalKgCo2e: number
    trustTier: 'A' | 'B' | 'C'
    lineItems: Gri305LineItem[]
  }
  gri305_2: {
    label: 'Energy indirect (Scope 2) GHG emissions'
    totalKgCo2e: number
    trustTier: 'A' | 'B' | 'C'
    lineItems: Gri305LineItem[]
  }
  gri305_3: {
    label: 'Other indirect (Scope 3) GHG emissions'
    totalKgCo2e: number
    trustTier: 'A' | 'B' | 'C'
    byCategory: Array<{ category: number; name: string; totalKgCo2e: number; trustTier: 'A' | 'B' | 'C' }>
  }
  gri305_4?: Gri305Intensity
}

function lowestTier(tiers: Array<'A' | 'B' | 'C'>): 'A' | 'B' | 'C' {
  if (tiers.includes('C')) return 'C'
  if (tiers.includes('B')) return 'B'
  return 'A'
}

// [GRI 305-1] Gross direct Scope 1 GHG emissions
// [GRI 305-2] Energy indirect Scope 2 GHG emissions
// [GRI 305-3] Other indirect Scope 3 GHG emissions
// [GRI 305-4] GHG emissions intensity (optional)
export function buildGri305Disclosure(input: {
  entityName: string
  reportingYear: number
  scope1Records: Gri305InputRecord[]
  scope2Records: Gri305InputRecord[]
  scope3Inventory: Scope3InventoryResult
  emissionIntensityDenominator?: { value: number; unit: string; trustTier: 'A' | 'B' | 'C' }
}): Gri305Disclosure {
  const scope1Total = input.scope1Records.reduce((s, r) => s + r.value, 0)
  const scope2Total = input.scope2Records.reduce((s, r) => s + r.value, 0)
  const scope1Tier = lowestTier(input.scope1Records.map(r => r.trustTier))
  const scope2Tier = lowestTier(input.scope2Records.map(r => r.trustTier))

  const scope3Categories = input.scope3Inventory.categories.map(cat => ({
    category: cat.category,
    name: cat.name,
    totalKgCo2e: cat.totalKgCo2e,
    trustTier: lowestTier(
      (['A', 'B', 'C'] as const).filter(t => cat.byTier[t] > 0),
    ) as 'A' | 'B' | 'C',
  }))
  const scope3Tier = lowestTier(scope3Categories.map(c => c.trustTier))

  const disclosure: Gri305Disclosure = {
    standard: 'GRI 305',
    version: '2016',
    regulatoryReference: 'GRI 305: Emissions 2016 — Universal Standards',
    entityName: input.entityName,
    reportingYear: input.reportingYear,
    gri305_1: {
      label: 'Gross direct (Scope 1) GHG emissions',
      totalKgCo2e: scope1Total,
      trustTier: scope1Tier,
      lineItems: input.scope1Records.map(r => ({
        recordId: r.id,
        fieldName: r.fieldName,
        value: r.value,
        unit: r.unit,
        trustTier: r.trustTier,
      })),
    },
    gri305_2: {
      label: 'Energy indirect (Scope 2) GHG emissions',
      totalKgCo2e: scope2Total,
      trustTier: scope2Tier,
      lineItems: input.scope2Records.map(r => ({
        recordId: r.id,
        fieldName: r.fieldName,
        value: r.value,
        unit: r.unit,
        trustTier: r.trustTier,
      })),
    },
    gri305_3: {
      label: 'Other indirect (Scope 3) GHG emissions',
      totalKgCo2e: input.scope3Inventory.totalKgCo2e,
      trustTier: scope3Tier,
      byCategory: scope3Categories,
    },
  }

  if (input.emissionIntensityDenominator) {
    const totalCo2e = scope1Total + scope2Total + input.scope3Inventory.totalKgCo2e
    const allTiers = [scope1Tier, scope2Tier, scope3Tier, input.emissionIntensityDenominator.trustTier]
    disclosure.gri305_4 = {
      ratioKgCo2ePerUnit: input.emissionIntensityDenominator.value > 0
        ? totalCo2e / input.emissionIntensityDenominator.value
        : 0,
      denominatorValue: input.emissionIntensityDenominator.value,
      denominatorUnit: input.emissionIntensityDenominator.unit,
      trustTier: lowestTier(allTiers),
    }
  }

  return disclosure
}
