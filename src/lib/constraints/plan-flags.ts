// Upgrade 3 — intake flagging (pure). The brain's /constraints/check returns
// algebraic-constraint violations per document; each violation names a concrete
// field. This maps every violation back to the stored DataRecord for that field
// so it can be raised as a non-blocking ValidationFlag. Violations whose field
// has no stored record are dropped — a flag needs a record to attach to.
//
// Pure: no DB, no network. The impure caller in run-constraint-validation.ts
// reads the records, calls the brain (fail-soft), and writes the flags.
//
// The record index is a nested Map (documentId → fieldName → id) rather than a
// concatenated string key on purpose: a hand-typed key separator is how a stray
// NUL byte has slipped into this codebase before.

import type { ConstraintRecordResult } from '@/lib/brain/types'

/** A stored DataRecord located by its document + field name. */
export interface RecordRef {
  documentId: string
  fieldName: string
  dataRecordId: string
}

export type FlagSeverity = 'INFO' | 'WARNING' | 'CRITICAL'

export interface PlannedFlag {
  dataRecordId: string
  flagType: 'INTERNAL_INCONSISTENCY'
  message: string
  severity: FlagSeverity
}

const VALID_SEVERITIES: readonly FlagSeverity[] = ['INFO', 'WARNING', 'CRITICAL']

function normaliseSeverity(raw: string): FlagSeverity {
  const upper = raw.toUpperCase()
  return (VALID_SEVERITIES as readonly string[]).includes(upper)
    ? (upper as FlagSeverity)
    : 'WARNING'
}

export function planConstraintFlags(
  results: ConstraintRecordResult[],
  records: RecordRef[],
): PlannedFlag[] {
  // documentId → (fieldName → dataRecordId)
  const byDoc = new Map<string, Map<string, string>>()
  for (const r of records) {
    let fields = byDoc.get(r.documentId)
    if (!fields) {
      fields = new Map<string, string>()
      byDoc.set(r.documentId, fields)
    }
    fields.set(r.fieldName, r.dataRecordId)
  }

  const flags: PlannedFlag[] = []
  for (const result of results) {
    const fields = byDoc.get(result.id)
    if (!fields) continue
    for (const v of result.violations) {
      const dataRecordId = fields.get(v.field)
      if (!dataRecordId) continue // derived/absent field — nothing to attach to
      flags.push({
        dataRecordId,
        flagType: 'INTERNAL_INCONSISTENCY',
        message: v.message,
        severity: normaliseSeverity(v.severity),
      })
    }
  }
  return flags
}

/** An already-persisted constraint flag, keyed on what makes it a duplicate. */
export interface ExistingFlag {
  dataRecordId: string
  message: string
}

/**
 * Keep only planned flags that aren't already persisted, matched on
 * (dataRecordId, message). Constraint checks are re-derived deterministically from
 * immutable record values, so a given violation yields the same message every run —
 * this makes the flag write idempotent under an inngest step retry (no unique
 * constraint exists on ValidationFlag). Pure: no DB, no network.
 */
export function dedupeNewFlags(planned: PlannedFlag[], existing: ExistingFlag[]): PlannedFlag[] {
  const seen = new Set<string>()
  for (const e of existing) seen.add(JSON.stringify([e.dataRecordId, e.message]))
  return planned.filter((f) => !seen.has(JSON.stringify([f.dataRecordId, f.message])))
}
