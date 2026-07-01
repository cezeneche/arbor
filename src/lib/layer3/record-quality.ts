// Layer 3 — Access. Read-only summary of records that already exist in the
// database. Counts and classifies; it does not calculate, transform values, or
// write. Powers the calm data-quality summary now folded into the Records screen.

import { composeTiers, type TierComposition } from './tier-composition'

export type QualityRecord = {
  domain: string
  fieldName: string
  trustTier: 'A' | 'B' | 'C'
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
  // Upgrade 6 — the aggregate's semilattice meet + tier distribution, so any
  // composite view of this record set carries an honest, defined tier.
  tierComposition: TierComposition
}

const DEFAULT_EXPIRY_WINDOW_DAYS = 30

export function summariseRecordQuality(
  records: QualityRecord[],
  compulsoryByDomain: Record<string, string[]>,
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

  // Track which compulsory fields are present, per domain that actually has data.
  const presentByDomain: Record<string, Set<string>> = {}

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
  }

  // Only domains that have data can be "missing" a compulsory field — we never
  // invent a gap for a domain the entity has never submitted to.
  let missingCompulsoryFields = 0
  for (const [domain, present] of Object.entries(presentByDomain)) {
    const expected = compulsoryByDomain[domain] ?? []
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
