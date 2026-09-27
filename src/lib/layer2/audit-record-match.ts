// Layer 2 — whether a chain entry still describes the record it names. Pure.
//
// The chain proves its entries were not edited; this proves the rows were not
// edited underneath them. Each entry is compared with the live record on the
// fields it attests to, and those depend on the event. A creation entry attests
// to the whole record, including who submitted it. A withdrawal entry echoes
// the record but is stamped with who withdrew it and when — comparing that
// actor against the original submitter reported every withdrawal made by a
// colleague as tampering.

import type { AuditPayload } from './audit-chain'

export interface StoredRecordFields {
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
  submittedById: string
}

/** Events whose actor is the one acting on the record, not its submitter. */
const ACTOR_IS_NOT_SUBMITTER = new Set(['WITHDRAWN'])

/** The fields on which the entry and the record disagree. Empty means none. */
export function auditPayloadMismatches(
  eventType: string,
  p: AuditPayload,
  record: StoredRecordFields,
): string[] {
  const mismatches: string[] = []
  if (record.domain !== p.domain) mismatches.push('domain')
  if (record.fieldName !== p.fieldName) mismatches.push('fieldName')
  if (record.value !== p.value) mismatches.push('value')
  if (record.unit !== p.unit) mismatches.push('unit')
  // A record with no pre-normalisation figure was stored in the unit it arrived
  // in, and payloads say so (see buildWithdrawalPayload).
  if ((record.originalValue ?? record.value) !== p.originalValue) mismatches.push('originalValue')
  if ((record.originalUnit ?? record.unit) !== p.originalUnit) mismatches.push('originalUnit')
  // Compare period dates as ISO strings — DB returns Date objects, payload stores strings.
  if (new Date(record.periodStart).toISOString() !== p.periodStart) mismatches.push('periodStart')
  if (new Date(record.periodEnd).toISOString() !== p.periodEnd) mismatches.push('periodEnd')
  if (record.trustTier !== p.trustTier) mismatches.push('trustTier')
  if (record.confidenceScore !== p.confidenceScore) mismatches.push('confidenceScore')
  if ((record.sourceText ?? null) !== p.sourceText) mismatches.push('sourceText')
  if ((record.documentId ?? null) !== p.documentId) mismatches.push('documentId')
  if (record.extractionMethod !== p.extractionMethod) mismatches.push('extractionMethod')
  if (!ACTOR_IS_NOT_SUBMITTER.has(eventType) && record.submittedById !== p.submittedById) {
    mismatches.push('submittedById')
  }
  return mismatches
}
