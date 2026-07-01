// Layer 2  -  pure function. No DB reads. No API calls. No side effects.
// Sector benchmark computation from anonymised, multi-entity Tier A dataset.
// [PRD §15.2  -  Aggregated and anonymised benchmark product]

import { composeTiers, type TierComposition } from '@/lib/layer3/tier-composition'

export const BENCHMARK_MIN_ENTITIES = 10

export interface BenchmarkRecord {
  entityId: string
  sector: string
  domain: string
  fieldName: string
  value: number
  unit: string
  trustTier: 'A' | 'B' | 'C'
}

export interface SectorBenchmarkResult {
  sector: string
  domain: string
  fieldName: string
  unit: string
  year: number
  minValue: number
  maxValue: number
  meanValue: number
  medianValue: number
  stddevValue: number
  entityCount: number
  tierAPercent: number
  // Upgrade 6 — the aggregate's semilattice meet + tier distribution, so this
  // composite benchmark carries an honest, defined trust tier like every other
  // aggregate output.
  tierComposition: TierComposition
}

export function validateAnonymisation(entityCount: number, minThreshold = BENCHMARK_MIN_ENTITIES): boolean {
  return entityCount >= minThreshold
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function stddev(values: number[], mean: number): number {
  if (values.length < 2) return 0
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

export function computeSectorBenchmarks(
  input: { records: BenchmarkRecord[]; year: number },
): SectorBenchmarkResult[] {
  // Group by sector + domain + fieldName
  type GroupKey = string
  const groups = new Map<GroupKey, BenchmarkRecord[]>()

  for (const record of input.records) {
    const key = `${record.sector}__${record.domain}__${record.fieldName}__${record.unit}`
    const existing = groups.get(key) ?? []
    existing.push(record)
    groups.set(key, existing)
  }

  const results: SectorBenchmarkResult[] = []

  for (const [, records] of groups.entries()) {
    // One value per entity (average if multiple records per entity for this field)
    const byEntity = new Map<string, number[]>()
    for (const r of records) {
      if (typeof r.value !== 'number' || isNaN(r.value)) continue
      const vals = byEntity.get(r.entityId) ?? []
      vals.push(r.value)
      byEntity.set(r.entityId, vals)
    }

    const entityCount = byEntity.size

    // Anonymisation gate  -  enforced here, not just at the API layer
    if (!validateAnonymisation(entityCount)) continue

    const entityValues = Array.from(byEntity.values()).map(
      vals => vals.reduce((s, v) => s + v, 0) / vals.length,
    )
    const sorted = [...entityValues].sort((a, b) => a - b)
    const mean = entityValues.reduce((s, v) => s + v, 0) / entityValues.length

    const tierACount = records.filter(r => r.trustTier === 'A').length
    const tierAPercent = records.length > 0 ? (tierACount / records.length) * 100 : 0

    const first = records[0]
    results.push({
      sector: first.sector,
      domain: first.domain,
      fieldName: first.fieldName,
      unit: first.unit,
      year: input.year,
      minValue: sorted[0],
      maxValue: sorted[sorted.length - 1],
      meanValue: mean,
      medianValue: median(sorted),
      stddevValue: stddev(entityValues, mean),
      entityCount,
      tierAPercent,
      tierComposition: composeTiers(records.map(r => r.trustTier)),
    })
  }

  return results
}

// Returns the percentile rank of an entity's value within a benchmark (0–100)
export function benchmarkPercentileRank(
  entityValue: number,
  benchmark: Pick<SectorBenchmarkResult, 'minValue' | 'maxValue'>,
): number {
  const range = benchmark.maxValue - benchmark.minValue
  if (range === 0) return 50
  const rank = ((entityValue - benchmark.minValue) / range) * 100
  return Math.max(0, Math.min(100, Math.round(rank)))
}
