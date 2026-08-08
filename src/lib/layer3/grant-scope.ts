import type { DataDomain } from '@prisma/client'

// Whether an access grant's scope covers a given record. A null grant dimension
// means "unbounded" on that axis (any domain / open-ended period / every field).
// This is the single source of truth for grant-to-record scoping — it gates what
// a buyer may read across the supply chain, so it must not drift between query
// paths. Anything reading records on a buyer's behalf goes through here.
export interface GrantScope {
  domain: DataDomain | null
  periodStart: Date | null
  periodEnd: Date | null
  /** Field names the grant covers. Null/undefined means every field. */
  fieldNames?: string[] | null
}

export interface ScopedRecord {
  domain: DataDomain
  periodStart: Date
  periodEnd: Date
  fieldName?: string
}

export function grantCoversRecord(grant: GrantScope, record: ScopedRecord): boolean {
  const domainMatch = !grant.domain || grant.domain === record.domain
  // Periods overlap when the record ends on/after the grant start and begins
  // on/before the grant end.
  const startMatch = !grant.periodStart || record.periodEnd >= grant.periodStart
  const endMatch = !grant.periodEnd || record.periodStart <= grant.periodEnd
  // A field-scoped grant covers only the fields it names. A record whose field is
  // unknown to the caller cannot be shown under such a grant — the safe reading of
  // "I don't know what this is" is "not in scope".
  const fieldMatch =
    !grant.fieldNames || grant.fieldNames.length === 0
      ? true
      : record.fieldName !== undefined && grant.fieldNames.includes(record.fieldName)

  return domainMatch && startMatch && endMatch && fieldMatch
}

/** True when at least one of `grants` covers `record`. */
export function anyGrantCoversRecord(grants: GrantScope[], record: ScopedRecord): boolean {
  return grants.some((g) => grantCoversRecord(g, record))
}

/** Reads the stored JSON field list back into the shape GrantScope expects.
 *  Anything that is not an array of strings is treated as "no field restriction",
 *  which matches the null case rather than silently hiding every record. */
export function parseGrantFieldNames(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const names = raw.filter((v): v is string => typeof v === 'string')
  return names.length > 0 ? names : null
}

/** The columns that make up a grant's scope. Every read path that filters records
 *  for a buyer selects exactly this, so adding a scope dimension cannot leave one
 *  path silently reading on the old, wider rules. */
export const GRANT_SCOPE_SELECT = {
  domain: true,
  periodStart: true,
  periodEnd: true,
  fieldNames: true,
} as const

export function toGrantScope(row: {
  domain: DataDomain | null
  periodStart: Date | null
  periodEnd: Date | null
  fieldNames?: unknown
}): GrantScope {
  return {
    domain: row.domain,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    fieldNames: parseGrantFieldNames(row.fieldNames),
  }
}
