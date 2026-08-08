// Layer 2 — what "delete this document" can honestly mean, given its state.
// Pure: decides and describes, writes nothing. The route does the writing.
//
// Before anything is saved a document is just a file and an extraction, and
// deleting it removes both. Once it has become records the word cannot mean
// that: those records are links in the entity's HMAC audit chain, and the chain
// is append-only (PRD §20.3). Removing a link would break every hash after it,
// which is the one thing a certified repository must never do.
//
// So a saved document is withdrawn instead. Its records leave the active set,
// so they stop appearing in records, totals, coverage and exports — everywhere
// the user looks, the document and its figures are gone — and the chain gains an
// entry per record saying it was withdrawn, by whom and when. Nothing is erased
// and nothing is rewritten, which is what keeps every earlier hash valid.

import type { AuditPayload } from './audit-chain'

export type RemovalMode = 'HARD_DELETE' | 'WITHDRAW'

/** The audit-relevant shape of a record about to leave the active set. */
export interface WithdrawableRecord {
  id: string
  entityId: string
  domain: string
  fieldName: string
  value: number
  unit: string
  originalValue: number | null
  originalUnit: string | null
  periodStart: Date
  periodEnd: Date
  trustTier: string
  confidenceScore: number
  sourceText: string | null
  documentId: string | null
  extractionMethod: string
}

export interface RemovalPlan {
  mode: RemovalMode
  /** The records to deactivate. Empty for a hard delete. */
  recordIds: string[]
}

/**
 * Acceptance is the point of no return: an accepted document, or one holding
 * records however it got them, is withdrawn rather than deleted. Everything else
 * — still in review, or rejected because it could not be read — never reached
 * the chain, so deleting it removes nothing anyone can audit.
 */
export function planDocumentRemoval(input: {
  status: string
  records: WithdrawableRecord[]
}): RemovalPlan {
  const certified = input.status === 'ACCEPTED' || input.records.length > 0
  return certified
    ? { mode: 'WITHDRAW', recordIds: input.records.map(r => r.id) }
    : { mode: 'HARD_DELETE', recordIds: [] }
}

/**
 * The chain entry for a withdrawal. It echoes the record it removes, so the
 * entry is a full statement of what left the active set rather than a pointer to
 * a row someone would have to go and read. `submittedAt` / `submittedById` are
 * the withdrawal, not the original submission — the eventType (`WITHDRAWN`)
 * carries the meaning, as it does for every other non-creation event.
 *
 * Built in AuditPayload's declared order. The canonicaliser no longer depends on
 * that, but every writer reads the same way and it stays that way.
 */
export function buildWithdrawalPayload(
  record: WithdrawableRecord,
  withdrawal: { at: Date; byId: string },
): AuditPayload {
  return {
    recordId: record.id,
    entityId: record.entityId,
    domain: record.domain,
    fieldName: record.fieldName,
    value: record.value,
    unit: record.unit,
    // Nullable on the row, not in the payload: a record with no pre-normalisation
    // figure was stored in the unit it arrived in.
    originalValue: record.originalValue ?? record.value,
    originalUnit: record.originalUnit ?? record.unit,
    periodStart: record.periodStart.toISOString(),
    periodEnd: record.periodEnd.toISOString(),
    trustTier: record.trustTier,
    confidenceScore: record.confidenceScore,
    sourceText: record.sourceText,
    documentId: record.documentId,
    extractionMethod: record.extractionMethod,
    submittedAt: withdrawal.at.toISOString(),
    submittedById: withdrawal.byId,
  }
}
