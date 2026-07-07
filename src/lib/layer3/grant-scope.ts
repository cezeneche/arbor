import type { DataDomain } from '@prisma/client'

// Whether an access grant's scope covers a given record. A null grant dimension
// means "unbounded" on that axis (any domain / open-ended period). This is the
// single source of truth for grant-to-record scoping — it gates what a buyer may
// read across the supply chain, so it must not drift between query paths.
export interface GrantScope {
  domain: DataDomain | null
  periodStart: Date | null
  periodEnd: Date | null
}

export interface ScopedRecord {
  domain: DataDomain
  periodStart: Date
  periodEnd: Date
}

export function grantCoversRecord(grant: GrantScope, record: ScopedRecord): boolean {
  const domainMatch = !grant.domain || grant.domain === record.domain
  // Periods overlap when the record ends on/after the grant start and begins
  // on/before the grant end.
  const startMatch = !grant.periodStart || record.periodEnd >= grant.periodStart
  const endMatch = !grant.periodEnd || record.periodStart <= grant.periodEnd
  return domainMatch && startMatch && endMatch
}

/** True when at least one of `grants` covers `record`. */
export function anyGrantCoversRecord(grants: GrantScope[], record: ScopedRecord): boolean {
  return grants.some((g) => grantCoversRecord(g, record))
}
