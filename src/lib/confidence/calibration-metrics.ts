// measurement loop. Pure: no DB, no network.
//
// The brain fits calibration and returns per-group ECE / Brier / reliability
// each run, but nothing was reading them: the calibration machine was producing
// numbers no one tracked. This module closes the loop. It turns the brain's
// report into headline metrics the cron persists, and evaluates the plan's kill
// signal:
//
//   "If, at three months of production data, the calibration ECE cannot be
//    brought below 5% for the top three field types (supplier identity, mass,
//    emissions intensity), the model class is wrong."
//
// A breach is only meaningful once a group has enough labels to trust its ECE,
// so an insufficient group (or an unmeasurable null ECE) never breaches — it is
// simply not yet judged.

import type { FieldType } from '@/lib/brain/field-types'
import type { GroupCalibration } from '@/lib/brain/types'

/** The three field types the plan's kill signal is defined against. */
export const KILL_SIGNAL_GROUPS: readonly FieldType[] = [
  'supplier_identity',
  'mass',
  'emissions_intensity',
] as const

/** Headline ECE ceiling for a kill-signal group (5%, from the plan). */
export const ECE_KILL_THRESHOLD = 0.05

const KILL_SIGNAL_SET: ReadonlySet<string> = new Set(KILL_SIGNAL_GROUPS)

/** One persistable metric row: a group's calibration at a point in time. */
export interface GroupMetric {
  group: string
  n: number
  brier: number | null
  ece: number | null
  sufficient: boolean
  /** True if this group is one of the plan's three kill-signal field types. */
  isKillSignalGroup: boolean
  /** True only when a sufficient kill-signal group's ECE exceeds the threshold. */
  breached: boolean
}

export interface CalibrationRunEvaluation {
  metrics: GroupMetric[]
  /** True if any kill-signal group breached this run — the headline alarm. */
  killSignalBreached: boolean
}

/** A group breaches only if it is a kill-signal type, has enough labels, and its
 *  measured ECE is strictly above the threshold. */
function isBreach(group: GroupCalibration): boolean {
  return (
    KILL_SIGNAL_SET.has(group.group) &&
    group.sufficient &&
    group.ece !== null &&
    group.ece > ECE_KILL_THRESHOLD
  )
}

/** Turn the brain's per-group calibration report into persistable headline
 *  metrics and evaluate the kill signal across the run. */
export function evaluateCalibrationRun(groups: GroupCalibration[]): CalibrationRunEvaluation {
  const metrics: GroupMetric[] = groups.map(g => ({
    group: g.group,
    n: g.n,
    brier: g.brier,
    ece: g.ece,
    sufficient: g.sufficient,
    isKillSignalGroup: KILL_SIGNAL_SET.has(g.group),
    breached: isBreach(g),
  }))
  return {
    metrics,
    killSignalBreached: metrics.some(m => m.breached),
  }
}
