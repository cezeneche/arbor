import type { DataDomain } from '@prisma/client'
import { grantCoversRecord, type GrantScope, type ScopedRecord } from './grant-scope'

// A stored record reduced to what gap analysis needs: its domain, trust tier, and
// period (the period drives grant-scope matching via grantCoversRecord).
export interface GapRecord extends ScopedRecord {
  trustTier: string
}

export interface SupplierGaps {
  missingDomains: DataDomain[]
  estimatedOnlyDomains: DataDomain[]
}

// Domains the buyer is actually entitled to see for this supplier. A grant with a
// null domain is unbounded (all domains); otherwise only the named domains are in
// scope. Gaps are never reported outside these domains, so a buyer cannot infer
// coverage for a domain they were not granted.
export function grantedDomains(
  grants: GrantScope[],
  allDomains: readonly DataDomain[],
): DataDomain[] {
  if (grants.some((g) => g.domain === null)) return [...allDomains]
  const named = new Set(grants.map((g) => g.domain).filter((d): d is DataDomain => d !== null))
  return allDomains.filter((d) => named.has(d))
}

// Coverage gaps computed strictly within grant scope: records outside a grant's
// domain/period are ignored, and only granted domains are considered. This is the
// buyer-facing gap view for the supply-chain API and must apply the same
// grant-scoping as every other read path (grantCoversRecord).
export function computeScopedGaps(
  grants: GrantScope[],
  records: GapRecord[],
  allDomains: readonly DataDomain[],
): SupplierGaps {
  const covered = records.filter((r) => grants.some((g) => grantCoversRecord(g, r)))
  const missingDomains: DataDomain[] = []
  const estimatedOnlyDomains: DataDomain[] = []
  for (const domain of grantedDomains(grants, allDomains)) {
    const inDomain = covered.filter((r) => r.domain === domain)
    if (inDomain.length === 0) missingDomains.push(domain)
    else if (inDomain.every((r) => r.trustTier === 'C')) estimatedOnlyDomains.push(domain)
  }
  return { missingDomains, estimatedOnlyDomains }
}
