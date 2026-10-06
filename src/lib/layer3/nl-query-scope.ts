// Layer 3 — the scope of an "Ask your records" question. Pure: builds query
// clauses and descriptions, reads and writes nothing.
//
// What a buyer may see of a supplier is set by the supplier's grants, and every
// path that answers a question about suppliers has to stay inside them — in the
// query itself, not in a filter applied to whatever a capped query returned.
// And what the user is told was searched has to be what was searched, not the
// model's own account of the question.

import type { DataDomain } from '@prisma/client'
import type { GrantScope } from './grant-scope'
import { fieldLabel } from './field-label'
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { normaliseIdentityName } from '@/lib/entity-resolution/blocking'

export type SupplierGrant = GrantScope & { grantorEntityId: string }

export interface GrantClause {
  entityId: string
  domain?: DataDomain
  periodEnd?: { gte: Date }
  periodStart?: { lte: Date }
  fieldName?: { in: string[] }
}

/**
 * The records the grants cover, as a query clause — the same rule as
 * grantCoversRecord, applied by the database. Null when nothing is granted, so
 * the caller reads nothing rather than everything.
 */
export function grantedRecordsWhere(grants: readonly SupplierGrant[]): { OR: GrantClause[] } | null {
  if (grants.length === 0) return null
  return {
    OR: grants.map(g => ({
      entityId: g.grantorEntityId,
      ...(g.domain ? { domain: g.domain } : {}),
      ...(g.periodStart ? { periodEnd: { gte: g.periodStart } } : {}),
      ...(g.periodEnd ? { periodStart: { lte: g.periodEnd } } : {}),
      ...(g.fieldNames && g.fieldNames.length > 0 ? { fieldName: { in: g.fieldNames } } : {}),
    })),
  }
}

export interface AuthorisedSupplier {
  id: string
  name: string
}

export type SupplierScope =
  { kind: 'all' } | { kind: 'one'; id: string; name: string } | { kind: 'unmatched'; name: string }

/**
 * Which supplier a question is about. A named supplier that matches no
 * authorised one — or matches more than one — is reported as unmatched rather
 * than widened to every supplier, which answered about everyone else.
 */
export function resolveSupplierScope(
  parsed: { supplierEntityId?: string; supplierName?: string },
  suppliers: readonly AuthorisedSupplier[],
): SupplierScope {
  const byId = parsed.supplierEntityId ? suppliers.find(s => s.id === parsed.supplierEntityId) : undefined
  if (byId) return { kind: 'one', id: byId.id, name: byId.name }

  const asked = parsed.supplierName?.trim()
  if (!asked) {
    return parsed.supplierEntityId ? { kind: 'unmatched', name: parsed.supplierEntityId } : { kind: 'all' }
  }

  const wanted = normaliseIdentityName(asked)
  if (!wanted) return { kind: 'unmatched', name: asked }
  const exact = suppliers.filter(s => normaliseIdentityName(s.name) === wanted)
  const candidates =
    exact.length > 0 ? exact : suppliers.filter(s => normaliseIdentityName(s.name).includes(wanted))
  return candidates.length === 1
    ? { kind: 'one', id: candidates[0].id, name: candidates[0].name }
    : { kind: 'unmatched', name: asked }
}

/** The areas a supplier's grants cover; null when one grant covers every area. */
function grantedDomains(grants: readonly SupplierGrant[]): Set<string> | null {
  if (grants.some(g => !g.domain)) return null
  return new Set(grants.map(g => g.domain!))
}

/**
 * Areas a supplier has shared nothing for, among those the buyer asked about
 * and the supplier granted. `covered` must come from grant-scoped records.
 */
export function supplierGapsWithinGrants(params: {
  suppliers: readonly AuthorisedSupplier[]
  grants: readonly SupplierGrant[]
  covered: ReadonlyMap<string, ReadonlySet<string>>
  targetDomains: readonly string[]
}): { supplierEntityId: string; supplierName: string; missingDomains: string[] }[] {
  const gaps = []
  for (const s of params.suppliers) {
    const granted = grantedDomains(params.grants.filter(g => g.grantorEntityId === s.id))
    const askable = params.targetDomains.filter(d => granted === null || granted.has(d))
    const covered = params.covered.get(s.id) ?? new Set<string>()
    const missing = askable.filter(d => !covered.has(d))
    if (missing.length > 0)
      gaps.push({ supplierEntityId: s.id, supplierName: s.name, missingDomains: missing })
  }
  return gaps
}

const TIER_ONLY: Record<'A' | 'B' | 'C', string> = {
  A: 'Verified only',
  B: 'Declared only',
  C: 'Estimated only',
}

function day(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function periodText(start?: string | null, end?: string | null): string {
  if (start && end) return `${day(start)} to ${day(end)}`
  if (start) return `from ${day(start)}`
  if (end) return `up to ${day(end)}`
  return 'any period'
}

export interface AppliedScope {
  queryType: 'entity' | 'supply_chain' | 'gap' | 'historical'
  domain?: string | null
  fieldName?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  trustTier?: 'A' | 'B' | 'C' | null
  supplier: SupplierScope
}

/** What was searched, from the filters that ran. Shown above every answer. */
export function describeScope(scope: AppliedScope): string {
  const whose =
    scope.queryType === 'gap'
      ? 'Areas with no records, for you and your suppliers'
      : scope.queryType === 'supply_chain'
        ? scope.supplier.kind === 'one'
          ? scope.supplier.name
          : 'Records your suppliers have shared with you'
        : scope.queryType === 'historical'
          ? 'Your records over time'
          : 'Your records'

  const parts = [whose, scope.domain ? (DOMAIN_LABELS[scope.domain] ?? scope.domain) : 'all areas']
  if (scope.fieldName) parts.push(fieldLabel(scope.fieldName, scope.domain))
  parts.push(periodText(scope.periodStart, scope.periodEnd))
  if (scope.queryType !== 'gap') parts.push(scope.trustTier ? TIER_ONLY[scope.trustTier] : 'any status')
  return parts.join(' · ')
}
