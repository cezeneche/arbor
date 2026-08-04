// Flag ownership routing. Pure policy: no DB, no side effects — the impure
// caller performs the write.
//
// The store could already say "this record is internally inconsistent". It could
// not say who is accountable for resolving that, which is the difference between
// a quality signal and a quality control. A flag nobody owns is a flag nobody
// closes.
//
// Routing is: the steward for that record's domain, else any entity admin, else
// explicitly UNASSIGNED. The last case is reported rather than hidden, because a
// gap in stewardship is itself the finding — the Layer 3 workload summary shows
// unowned flags as their own bucket for exactly this reason.

import type { DataDomain } from '@/lib/constants'

export interface StewardAssignment {
  entityId: string
  domain: DataDomain
  userId: string
}

export interface EntityAdmin {
  entityId: string
  userId: string
  /** Used only to pick deterministically when an entity has several admins. */
  createdAt: Date
}

export type OwnerRoute = 'STEWARD' | 'ENTITY_ADMIN' | 'UNASSIGNED'

export interface FlagOwner {
  userId: string | null
  via: OwnerRoute
}

export interface OwnerLookup {
  entityId: string
  domain: DataDomain
  stewards: StewardAssignment[]
  admins: EntityAdmin[]
}

/**
 * Decide who owns a flag raised on a record in `domain` for `entityId`.
 *
 * Both lists are filtered by entity before use — a steward at another company
 * must never end up owning this company's data quality, however the caller
 * assembled the arrays.
 */
export function resolveFlagOwner({ entityId, domain, stewards, admins }: OwnerLookup): FlagOwner {
  const steward = stewards.find(s => s.entityId === entityId && s.domain === domain)
  if (steward) return { userId: steward.userId, via: 'STEWARD' }

  const ourAdmins = admins.filter(a => a.entityId === entityId)
  if (ourAdmins.length === 0) return { userId: null, via: 'UNASSIGNED' }

  // Longest-standing admin, then userId as a tiebreak so the fallback is stable
  // across calls and does not depend on query ordering.
  const chosen = [...ourAdmins].sort((a, b) => {
    const byAge = a.createdAt.getTime() - b.createdAt.getTime()
    return byAge !== 0 ? byAge : a.userId.localeCompare(b.userId)
  })[0]

  return { userId: chosen.userId, via: 'ENTITY_ADMIN' }
}
