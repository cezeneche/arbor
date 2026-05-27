// Layer 2 — Scope 3 inventory aggregation. Pure function: no DB reads, no API calls.
// [GHG Protocol Scope 3 Standard — all fifteen categories]

import { applyEmissionFactor } from '@/lib/calculation/emission-factors'

export interface Scope3Input {
  records: Array<{
    id: string
    domain: string
    scope3Category: number | null
    fieldName: string
    value: number
    unit: string
    trustTier: 'A' | 'B' | 'C'
    extractionMethod: string
  }>
  emissionFactors: Array<{
    activityType: string
    factor: number
    unit: string
    source: string
    version: string
    citation: string
  }>
}

export interface CategoryResult {
  category: number
  name: string
  totalKgCo2e: number
  byTier: { A: number; B: number; C: number }
  recordCount: number
  isMixedMethod: boolean
  dataComplete: boolean
  lineItems: Array<{
    recordId: string
    fieldName: string
    value: number
    unit: string
    tier: 'A' | 'B' | 'C'
    co2eKg: number
    factorApplied: string
  }>
}

export interface Scope3InventoryResult {
  categories: CategoryResult[]
  totalKgCo2e: number
  coverageReport: {
    fullyDataComplete: number[]
    partiallyEstimated: number[]
    notCovered: number[]
  }
  mixedMethodCategories: number[]
  gapClosePathway: Array<{
    category: number
    tierCVolume: number
    topSuppliersToUpgrade: string[]
  }>
}

const CATEGORY_NAMES: Record<number, string> = {
  1: 'Purchased goods and materials',
  2: 'Capital goods',
  3: 'Fuel and energy related activities',
  4: 'Upstream transportation and distribution',
  5: 'Waste generated in operations',
  6: 'Business travel',
  7: 'Employee commuting',
  8: 'Upstream leased assets',
  9: 'Downstream transportation and distribution',
  10: 'Processing of sold products',
  11: 'Use of sold products',
  12: 'End-of-life treatment of sold products',
  13: 'Downstream leased assets',
  14: 'Franchises',
  15: 'Investments',
}

// [GHG Protocol Scope 3 Standard Chapter 7] buildScope3Inventory
export function buildScope3Inventory(input: Scope3Input): Scope3InventoryResult {
  const recordsByCategory = new Map<number, typeof input.records>()
  for (const record of input.records) {
    if (record.scope3Category === null) continue
    if (!recordsByCategory.has(record.scope3Category))
      recordsByCategory.set(record.scope3Category, [])
    recordsByCategory.get(record.scope3Category)!.push(record)
  }

  const factorMap = new Map(input.emissionFactors.map((f) => [f.activityType, f]))
  const categoryMap = new Map<number, CategoryResult>()

  for (const [cat, records] of recordsByCategory.entries()) {
    const byTier: { A: number; B: number; C: number } = { A: 0, B: 0, C: 0 }
    let totalKgCo2e = 0
    const lineItems: CategoryResult['lineItems'] = []

    for (const record of records) {
      const factor = factorMap.get(`${record.domain}_${record.fieldName}`)
      let co2eKg = 0
      let factorApplied = 'none'

      if (factor) {
        const calc = applyEmissionFactor({
          activityValue: record.value,
          activityUnit: record.unit,
          factor: factor.factor,
          factorUnit: factor.unit,
          factorSource: factor.source,
          factorVersion: factor.version,
          citation: factor.citation,
        })
        co2eKg = calc.co2eKg
        factorApplied = calc.calculationExpression
      }

      byTier[record.trustTier] += co2eKg
      totalKgCo2e += co2eKg
      lineItems.push({
        recordId: record.id,
        fieldName: record.fieldName,
        value: record.value,
        unit: record.unit,
        tier: record.trustTier,
        co2eKg,
        factorApplied,
      })
    }

    const tiers = new Set(records.map((r) => r.trustTier))
    categoryMap.set(cat, {
      category: cat,
      name: CATEGORY_NAMES[cat] ?? `Category ${cat}`,
      totalKgCo2e,
      byTier,
      recordCount: records.length,
      isMixedMethod: tiers.size > 1,
      dataComplete: !tiers.has('C'),
      lineItems,
    })
  }

  const all15 = Array.from({ length: 15 }, (_, i) => i + 1)
  const covered = Array.from(categoryMap.keys())
  const fullyDataComplete = covered.filter((c) => categoryMap.get(c)!.dataComplete)
  const partiallyEstimated = covered.filter((c) => !categoryMap.get(c)!.dataComplete)
  const notCovered = all15.filter((c) => !covered.includes(c))
  const total = Array.from(categoryMap.values()).reduce((s, c) => s + c.totalKgCo2e, 0)

  return {
    categories: Array.from(categoryMap.values()),
    totalKgCo2e: total,
    coverageReport: { fullyDataComplete, partiallyEstimated, notCovered },
    mixedMethodCategories: covered.filter((c) => categoryMap.get(c)!.isMixedMethod),
    gapClosePathway: partiallyEstimated.map((cat) => ({
      category: cat,
      tierCVolume: categoryMap.get(cat)!.byTier.C,
      topSuppliersToUpgrade: [],
    })),
  }
}
