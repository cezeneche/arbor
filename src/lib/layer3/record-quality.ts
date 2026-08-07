// Layer 3 — Access. Read-only summary of records that already exist in the
// database. Counts and classifies; it does not calculate, transform values, or
// write. Powers the calm data-quality summary now folded into the Records screen.

import { composeTiers, type TierComposition } from './tier-composition'
import { expectedFieldsFor } from './compulsory-fields'

export type QualityRecord = {
  domain: string
  fieldName: string
  trustTier: 'A' | 'B' | 'C'
  /** The document type behind the record; null for manual entry. */
  documentType?: string | null
  /** Batch/mill records go stale after this date; null means they never stale. */
  staleAfterDate: Date | string | null
}

export type RecordQualitySummary = {
  total: number
  verified: number // Tier A
  declared: number // Tier B
  estimated: number // Tier C
  missingCompulsoryFields: number
  expiringSoon: number
  // the aggregate's semilattice meet + tier distribution, so any
  // composite view of this record set carries an honest, defined tier.
  tierComposition: TierComposition
}

const DEFAULT_EXPIRY_WINDOW_DAYS = 30

export function summariseRecordQuality(
  records: QualityRecord[],
  compulsoryByDocumentType: Record<string, string[]>,
  opts: { now?: Date; expiryWindowDays?: number } = {},
): RecordQualitySummary {
  const now = opts.now ?? new Date()
  const windowMs = (opts.expiryWindowDays ?? DEFAULT_EXPIRY_WINDOW_DAYS) * 24 * 60 * 60 * 1000
  const horizon = now.getTime() + windowMs

  let verified = 0
  let declared = 0
  let estimated = 0
  let expiringSoon = 0

  const tiers = records.map(r => r.trustTier)

  // Track what is present, and which document types were actually submitted —
  // a record set is only held to the specs of the documents behind it.
  const presentByDomain: Record<string, Set<string>> = {}
  const docTypesByDomain: Record<string, Set<string>> = {}

  for (const r of records) {
    if (r.trustTier === 'A') verified++
    else if (r.trustTier === 'B') declared++
    else estimated++

    if (r.staleAfterDate != null) {
      const stale = new Date(r.staleAfterDate).getTime()
      if (!Number.isNaN(stale) && stale <= horizon) expiringSoon++
    }

    if (!presentByDomain[r.domain]) presentByDomain[r.domain] = new Set()
    presentByDomain[r.domain].add(r.fieldName)
    if (!docTypesByDomain[r.domain]) docTypesByDomain[r.domain] = new Set()
    if (r.documentType) docTypesByDomain[r.domain].add(r.documentType)
  }

  // A gap is only a gap against a document this entity actually submitted. The
  // old version scored every domain against the union of its document types,
  // which marked a freight invoice as missing bill-of-lading fields.
  let missingCompulsoryFields = 0
  for (const [domain, present] of Object.entries(presentByDomain)) {
    const expected = expectedFieldsFor(
      [...(docTypesByDomain[domain] ?? [])],
      compulsoryByDocumentType,
    )
    for (const field of expected) {
      if (!present.has(field)) missingCompulsoryFields++
    }
  }

  return {
    total: records.length,
    verified,
    declared,
    estimated,
    missingCompulsoryFields,
    expiringSoon,
    tierComposition: composeTiers(tiers),
  }
}
