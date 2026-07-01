// Step 5 (Upgrade 1). Pure: no DB, no network.
//
// Given the brain's per-group calibration report and the set of active records,
// decide which records get a calibrated confidencePosterior written back and
// what that posterior is. The offline cron route wraps DB reads and batched
// writes around this planner; keeping the decision pure keeps it testable.

import { classifyFieldType } from '@/lib/brain/field-types'
import type { GroupCalibration } from '@/lib/brain/types'
import { buildPosterior } from './posterior'
import type { ConfidencePosterior } from './types'

export interface RecordForBackfill {
  id: string
  fieldName: string
  confidenceScore: number
}

export interface PosteriorUpdate {
  recordId: string
  posterior: ConfidencePosterior
}

/** The calibration group a field belongs to — coarse kill-signal type, else its own name. */
export function groupKeyForField(fieldName: string): string {
  return classifyFieldType(fieldName) ?? fieldName
}

/**
 * Compute the posterior write-backs for a batch of records. A record is updated
 * only when its group has a calibration; by default that calibration must be
 * `sufficient` (enough labels to trust the fit) so we never stamp a confident
 * posterior onto a group that hasn't earned one.
 */
export function buildPosteriorUpdates(
  records: RecordForBackfill[],
  groups: GroupCalibration[],
  opts: { requireSufficient?: boolean } = {},
): PosteriorUpdate[] {
  const requireSufficient = opts.requireSufficient ?? true
  const byGroup = new Map(groups.map(g => [g.group, g]))

  const updates: PosteriorUpdate[] = []
  for (const record of records) {
    const group = byGroup.get(groupKeyForField(record.fieldName))
    if (!group) continue
    if (requireSufficient && !group.sufficient) continue
    updates.push({
      recordId: record.id,
      posterior: buildPosterior(record.confidenceScore, group),
    })
  }
  return updates
}
