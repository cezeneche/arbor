// Whether the sender of an inbound data-request email is authorised to receive an
// automatic answer. A request is only auto-answered when the sender maps to an
// entity that holds an active DataAccessGrant covering the request's domain/period.
// This mirrors grant-to-record scoping (grant-scope.ts) but at the request level,
// where the domain/period may be unspecified.
import type { ParsedRequest } from '@/lib/requests/inbound-parse'
import type { GrantScope } from '@/lib/layer3/grant-scope'

export function grantAuthorisesRequest(grant: GrantScope, parsed: ParsedRequest): boolean {
  // A domain-scoped grant only authorises a request that is clearly within that
  // domain — a request with no/ambiguous domain is not covered.
  if (grant.domain !== null && grant.domain !== parsed.domain) return false

  const gs = grant.periodStart ? grant.periodStart.getTime() : null
  const ge = grant.periodEnd ? grant.periodEnd.getTime() : null
  const ps = parsed.periodStart ? Date.parse(parsed.periodStart) : null
  const pe = parsed.periodEnd ? Date.parse(parsed.periodEnd) : null

  // No overlap if the grant ends before the request starts, or begins after it ends.
  // A null bound (grant or request) is unbounded on that side.
  if (ge !== null && ps !== null && !Number.isNaN(ps) && ge < ps) return false
  if (gs !== null && pe !== null && !Number.isNaN(pe) && gs > pe) return false
  return true
}

export function anyGrantAuthorisesRequest(grants: GrantScope[], parsed: ParsedRequest): boolean {
  return grants.some((g) => grantAuthorisesRequest(g, parsed))
}
