// Layer 3 — Access. Read-only. Groups records already in the database into a
// coverage-by-quarter view and a period-over-period table of STORED values. It
// computes no new values, runs no AI, and writes nothing.

export type TrendRecord = {
  domain: string
  fieldName: string
  trustTier: 'A' | 'B' | 'C'
  value: number
  unit: string
  periodStart: Date | string
}

export type QuarterDomainCoverage = {
  domain: string
  presentFields: string[]
  missingFields: string[]
  extraFields: string[]
  pct: number
  tiers: { A: number; B: number; C: number }
}

export type QuarterCoverage = {
  quarter: string
  domains: QuarterDomainCoverage[]
}

export type ValuePoint = { quarter: string; value: number; unit: string; tier: 'A' | 'B' | 'C' }

export type PeriodOverPeriodField = {
  domain: string
  fieldName: string
  points: ValuePoint[]
}

export type RecordTrends = {
  quarters: QuarterCoverage[]
  periodOverPeriod: PeriodOverPeriodField[]
}

const QUARTERS_SHOWN = 4

// A chronologically sortable key (year*4 + quarter index) paired with a display label.
function quarterOf(date: Date): { sortKey: number; label: string } {
  const q = Math.floor(date.getMonth() / 3) + 1
  const year = date.getFullYear()
  return { sortKey: year * 4 + (q - 1), label: `Q${q} ${year}` }
}

export function buildRecordTrends(
  records: TrendRecord[],
  compulsoryByDomain: Record<string, string[]>,
): RecordTrends {
  // quarter sortKey → { label, domain → { fields, tiers } }
  const quarterMap = new Map<number, { label: string; domains: Map<string, { fields: Set<string>; tiers: { A: number; B: number; C: number } }> }>()
  // domain → fieldName → (quarter sortKey → ValuePoint) — first record seen per quarter wins
  const valueMap = new Map<string, Map<string, Map<number, ValuePoint & { sortKey: number }>>>()

  for (const r of records) {
    const { sortKey, label } = quarterOf(new Date(r.periodStart))

    if (!quarterMap.has(sortKey)) quarterMap.set(sortKey, { label, domains: new Map() })
    const qEntry = quarterMap.get(sortKey)!
    if (!qEntry.domains.has(r.domain)) qEntry.domains.set(r.domain, { fields: new Set(), tiers: { A: 0, B: 0, C: 0 } })
    const dEntry = qEntry.domains.get(r.domain)!
    dEntry.fields.add(r.fieldName)
    dEntry.tiers[r.trustTier]++

    if (!valueMap.has(r.domain)) valueMap.set(r.domain, new Map())
    const byField = valueMap.get(r.domain)!
    if (!byField.has(r.fieldName)) byField.set(r.fieldName, new Map())
    const byQuarter = byField.get(r.fieldName)!
    if (!byQuarter.has(sortKey)) {
      byQuarter.set(sortKey, { quarter: label, value: r.value, unit: r.unit, tier: r.trustTier, sortKey })
    }
  }

  const sortedQuarterKeys = [...quarterMap.keys()].sort((a, b) => a - b).slice(-QUARTERS_SHOWN)

  const quarters: QuarterCoverage[] = sortedQuarterKeys.map(key => {
    const { label, domains } = quarterMap.get(key)!
    const domainCoverage: QuarterDomainCoverage[] = [...domains.entries()].map(([domain, d]) => {
      const expected = compulsoryByDomain[domain] ?? []
      const presentFields = [...d.fields]
      const missingFields = expected.filter(f => !d.fields.has(f))
      const extraFields = presentFields.filter(f => !expected.includes(f))
      const pct = expected.length > 0
        ? Math.round(((expected.length - missingFields.length) / expected.length) * 100)
        : 100
      return { domain, presentFields, missingFields, extraFields, pct, tiers: d.tiers }
    })
    return { quarter: label, domains: domainCoverage }
  })

  const periodOverPeriod: PeriodOverPeriodField[] = []
  for (const [domain, byField] of valueMap.entries()) {
    for (const [fieldName, byQuarter] of byField.entries()) {
      if (byQuarter.size < 2) continue
      const points = [...byQuarter.values()]
        .sort((a, b) => a.sortKey - b.sortKey)
        .map(({ quarter, value, unit, tier }) => ({ quarter, value, unit, tier }))
      periodOverPeriod.push({ domain, fieldName, points })
    }
  }

  return { quarters, periodOverPeriod }
}
