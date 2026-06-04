// Layer 2 — pure function. No DB reads. No API calls. No side effects.
// Derives emission factors from Tier A records using mean + 95% confidence interval.
// Caller is responsible for filtering to Tier A records only before passing to this function.

export const FACTOR_MIN_SAMPLE = 5

export interface FactorRecord {
  domain: string
  fieldName: string
  value: number
  unit: string
}

export interface DerivedFactorResult {
  activityType: string        // domain_fieldName key
  factor: number              // mean across all Tier A records for this activity
  unit: string
  confidenceIntervalLower: number
  confidenceIntervalUpper: number
  sampleSize: number
  citation: string
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length
}

function sampleStddev(values: number[], avg: number): number {
  if (values.length < 2) return 0
  return Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1))
}

export function deriveEmissionFactors(input: {
  records: FactorRecord[]   // Tier A only — caller's responsibility to filter
  activityType: string
  sector?: string
  year: number
}): DerivedFactorResult | null {
  if (input.records.length < FACTOR_MIN_SAMPLE) return null

  // Guard: all records must share the same unit
  const units = new Set(input.records.map(r => r.unit))
  if (units.size > 1) return null

  const values = input.records.map(r => r.value)
  const avg = mean(values)
  const sd = sampleStddev(values, avg)
  const se = sd / Math.sqrt(values.length)
  const z95 = 1.96

  return {
    activityType: input.activityType,
    factor: avg,
    unit: [...units][0],
    confidenceIntervalLower: avg - z95 * se,
    confidenceIntervalUpper: avg + z95 * se,
    sampleSize: values.length,
    citation: `Arbor Tier A Dataset — ${input.sector ?? 'all sectors'} — derived ${input.year}. Sample size: ${values.length} verified records.`,
  }
}

export function deriveAllFactors(input: {
  records: FactorRecord[]   // Tier A only
  year: number
  sector?: string
}): DerivedFactorResult[] {
  const groups = new Map<string, FactorRecord[]>()

  for (const record of input.records) {
    const key = `${record.domain}_${record.fieldName}`
    const existing = groups.get(key) ?? []
    existing.push(record)
    groups.set(key, existing)
  }

  const results: DerivedFactorResult[] = []
  for (const [activityType, records] of groups.entries()) {
    const result = deriveEmissionFactors({ records, activityType, sector: input.sector, year: input.year })
    if (result) results.push(result)
  }
  return results
}
