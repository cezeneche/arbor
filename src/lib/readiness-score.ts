// Layer 2  -  pure function. No DB reads. No API calls. No side effects.
// Supplier Data Readiness Score: percentage of active DataRecords at Tier A, by domain.

export type ReadinessInterpretation = 'HIGH' | 'MEDIUM' | 'LOW'

export interface ReadinessInput {
  records: Array<{
    id: string
    domain: string
    trustTier: 'A' | 'B' | 'C'
  }>
}

export interface DomainReadiness {
  domain: string
  totalRecords: number
  tierACount: number
  score: number
  interpretation: ReadinessInterpretation
}

export interface ReadinessResult {
  overallScore: number
  interpretation: ReadinessInterpretation
  totalRecords: number
  tierACount: number
  byDomain: DomainReadiness[]
}

function interpret(score: number): ReadinessInterpretation {
  if (score >= 75) return 'HIGH'
  if (score >= 40) return 'MEDIUM'
  return 'LOW'
}

export function computeReadinessScore(input: ReadinessInput): ReadinessResult {
  const total = input.records.length
  const tierATotal = input.records.filter((r) => r.trustTier === 'A').length
  const overallScore = total === 0 ? 0 : Math.round((tierATotal / total) * 100)

  const domainMap = new Map<string, { total: number; tierA: number }>()
  for (const record of input.records) {
    if (!domainMap.has(record.domain)) domainMap.set(record.domain, { total: 0, tierA: 0 })
    const entry = domainMap.get(record.domain)!
    entry.total++
    if (record.trustTier === 'A') entry.tierA++
  }

  const byDomain: DomainReadiness[] = Array.from(domainMap.entries()).map(([domain, counts]) => {
    const score = counts.total === 0 ? 0 : Math.round((counts.tierA / counts.total) * 100)
    return {
      domain,
      totalRecords: counts.total,
      tierACount: counts.tierA,
      score,
      interpretation: interpret(score),
    }
  })

  return {
    overallScore,
    interpretation: interpret(overallScore),
    totalRecords: total,
    tierACount: tierATotal,
    byDomain,
  }
}
