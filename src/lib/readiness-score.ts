// Supplier Data Readiness (PRD §16.2, §18.2). Pure: no DB, no side effects.
//
// Readiness is measured against what the buyer asked this supplier for. It used
// to be the share of the supplier's records that were Verified, which is a
// statement about quality, not completeness: a supplier with one Verified
// record and nothing else scored 100% and showed green. Now each requested
// figure is counted once, as supplied or not, and verification is reported
// beside that count rather than blended into it. With nothing requested there
// is nothing to be ready for, and no score.

export interface ReadinessRequest {
  domain: string
  periodStart: Date
  periodEnd: Date
  /** Empty means anything in the domain answers it. */
  requiredFields: readonly string[]
}

export interface ReadinessRecord {
  domain: string
  fieldName: string
  periodStart: Date
  periodEnd: Date
  trustTier: 'A' | 'B' | 'C'
}

export interface SupplierReadiness {
  /** Figures asked for: one per required field per request. */
  requested: number
  /** Of those, how many a shared record answers. */
  supplied: number
  /** Of those supplied, how many a Verified record answers. */
  verified: number
}

export function supplierReadiness(input: {
  requests: readonly ReadinessRequest[]
  records: readonly ReadinessRecord[]
}): SupplierReadiness | null {
  if (input.requests.length === 0) return null

  let requested = 0
  let supplied = 0
  let verified = 0
  for (const req of input.requests) {
    const inScope = input.records.filter(
      r => r.domain === req.domain && r.periodStart <= req.periodEnd && r.periodEnd >= req.periodStart,
    )
    const asks: (string | null)[] = req.requiredFields.length > 0 ? [...req.requiredFields] : [null]
    for (const field of asks) {
      requested++
      const answering = field === null ? inScope : inScope.filter(r => r.fieldName === field)
      if (answering.length === 0) continue
      supplied++
      if (answering.some(r => r.trustTier === 'A')) verified++
    }
  }
  return { requested, supplied, verified }
}
