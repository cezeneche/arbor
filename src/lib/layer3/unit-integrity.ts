// Layer 3 — Access. Pure, read-only. §1: one canonical unit per record type.
//
// A record type declares its canonical unit in the definitions catalogue, and
// the writer converts to it on the way in. A record stored in anything else got
// past that path and is invalid — not a labelling problem, a data problem, and
// therefore a blocking item rather than something to paper over in the copy.
//
// arbor never converts on read. Where records inside one figure disagree on
// unit, the figure is not summed; the conflict is counted and shown.

import { SEED_DEFINITIONS } from '@/lib/definitions/catalogue'

export interface UnitCheckRecord {
  id: string
  domain: string
  fieldName: string
  unit: string
}

export interface UnitConflict {
  recordId: string
  domain: string
  fieldName: string
  /** What the record is stored in. */
  unit: string
  /** What its type declares. */
  expected: string
}

/** `DOMAIN::field_name` → canonical unit, or null where the type declares none. */
export type CanonicalUnitIndex = Record<string, string | null>

export const unitKey = (domain: string, fieldName: string) => `${domain}::${fieldName}`

export function canonicalUnitIndex(): CanonicalUnitIndex {
  const index: CanonicalUnitIndex = {}
  for (const entry of SEED_DEFINITIONS) {
    index[unitKey(entry.domain, entry.fieldName)] = entry.canonicalUnit
  }
  return index
}

/** Case and padding are not real differences; anything else is. */
const normalise = (unit: string) => unit.trim().toLowerCase()

export function findUnitConflicts(
  records: UnitCheckRecord[],
  canonical: CanonicalUnitIndex,
): UnitConflict[] {
  const conflicts: UnitConflict[] = []
  for (const record of records) {
    const expected = canonical[unitKey(record.domain, record.fieldName)]
    // Absent from the catalogue, or declaring no unit (categorical,
    // dimensionless): nothing to be inconsistent with.
    if (expected === undefined || expected === null) continue
    if (normalise(record.unit) === normalise(expected)) continue
    conflicts.push({
      recordId: record.id,
      domain: record.domain,
      fieldName: record.fieldName,
      unit: record.unit,
      expected,
    })
  }
  return conflicts
}
