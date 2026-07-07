// reshape stored records into per-document field sets for the
// constraint check. Pure: no DB, no network.
//
// Each DataRecord is one field; the algebraic constraints (emissions balance,
// intensity bounds) are relationships *between* a document's fields, so we group
// a document's records back into a single {fieldName: value} bag before checking.

import type { ConstraintRecordInput } from '@/lib/brain/types'

export interface RecordRow {
  documentId: string
  fieldName: string
  value: number
  sector: string | null
}

/** Group records by document into one constraint-check input each. */
export function groupRecordsByDocument(rows: RecordRow[]): ConstraintRecordInput[] {
  const byDoc = new Map<string, ConstraintRecordInput>()
  for (const r of rows) {
    let entry = byDoc.get(r.documentId)
    if (!entry) {
      entry = { id: r.documentId, sector: r.sector, fields: {} }
      byDoc.set(r.documentId, entry)
    }
    // First non-null sector wins; later rows don't clobber it.
    if (entry.sector == null && r.sector != null) entry.sector = r.sector
    entry.fields[r.fieldName] = r.value
  }
  return [...byDoc.values()]
}
