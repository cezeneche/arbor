// Accuracy & drift monitor (MLOps guardrail). Pure: no DB, no network.
//
// Calibration ECE measures whether the model's *confidence* is honest. It says
// nothing about whether extraction is *correct*, nor whether the input mix has
// drifted underneath a model that never changed. This module measures both,
// straight from the ground-truth stream a cron feeds it:
//
//   - recent correct-rate vs the historical baseline, per field group (has
//     accuracy DEGRADED?)
//   - the Population Stability Index between the two windows' confidence
//     distributions (has the input/model DRIFTED?)
//
// A verdict is only issued once BOTH windows carry enough labels to be trusted.
// A thin window is reported but never judged — the same "not yet judged" posture
// as the calibration kill signal, so early production never cries wolf.
//
// This runs in TS, not the brain: the arithmetic is trivial and a monitoring job
// must not depend on the brain being up to notice the brain going wrong.

import { classifyFieldType } from '@/lib/brain/field-types'
import { KILL_SIGNAL_GROUPS } from '@/lib/confidence/calibration-metrics'

/** Newest N labels compared against everything older, per group. */
export const DEFAULT_RECENT_WINDOW = 200
/** A window must carry at least this many labels before its group is judged. */
export const DEFAULT_MIN_SAMPLES = 30
/** Recent correct-rate this far below baseline (absolute) = degradation. */
export const ACCURACY_DROP_THRESHOLD = 0.1
/** PSI at or above this = a significant confidence-distribution shift (standard convention). */
export const PSI_DRIFT_THRESHOLD = 0.2
/** Fixed bins over the [0,1] confidence range for PSI. */
export const PSI_BINS = 10

// Floor on a bin proportion so an empty bin never yields log(0) / division by
// zero. Small enough not to perturb a populated bin.
const PSI_EPSILON = 1e-4

const KILL_SIGNAL_SET: ReadonlySet<string> = new Set(KILL_SIGNAL_GROUPS)
const OTHER_GROUP = 'other'

/** Minimal projection of a GroundTruthLabel the monitor needs. */
export interface DriftLabel {
  fieldName: string
  wasCorrect: boolean
  confidenceAtExtraction: number
  /** Epoch millis (or any monotonic recency key) — used only to order windows. */
  createdAt: number
}

export interface GroupDrift {
  group: string
  isKillSignalGroup: boolean
  recentN: number
  baselineN: number
  recentAccuracy: number | null
  baselineAccuracy: number | null
  /** recentAccuracy − baselineAccuracy; negative = correctness fell. Null if unmeasurable. */
  accuracyDelta: number | null
  confidencePsi: number | null
  /** Both windows carry ≥ minSamples — only then is a verdict issued. */
  sufficient: boolean
  /** sufficient ∧ correct-rate dropped ≥ ACCURACY_DROP_THRESHOLD. */
  accuracyDegraded: boolean
  /** sufficient ∧ confidence PSI ≥ PSI_DRIFT_THRESHOLD. */
  confidenceDrift: boolean
}

export interface DriftReport {
  groups: GroupDrift[]
  /** True if any group degraded or drifted — the headline alarm. */
  degraded: boolean
}

/** Bin index for a confidence value, clamped into [0, bins-1]. */
function binOf(value: number, bins: number): number {
  const v = Math.max(0, Math.min(1, value))
  return Math.min(bins - 1, Math.floor(v * bins))
}

/** Bin proportions over [0,1], floored at PSI_EPSILON so no bin is empty. */
function proportions(values: number[], bins: number): number[] {
  const counts = new Array(bins).fill(0)
  for (const v of values) counts[binOf(v, bins)] += 1
  const total = values.length
  return counts.map(c => Math.max(c / total, PSI_EPSILON))
}

/**
 * Population Stability Index between a baseline and a recent sample of [0,1]
 * confidence values. 0 = identical; by convention <0.1 no shift, 0.1–0.2
 * moderate, >0.2 significant. Returns 0 when either sample is empty (nothing to
 * compare — the sufficiency gate decides whether a group is judged at all).
 */
export function populationStabilityIndex(
  baseline: number[],
  recent: number[],
  bins: number = PSI_BINS,
): number {
  if (baseline.length === 0 || recent.length === 0) return 0
  const b = proportions(baseline, bins)
  const r = proportions(recent, bins)
  let psi = 0
  for (let i = 0; i < bins; i++) {
    psi += (r[i] - b[i]) * Math.log(r[i] / b[i])
  }
  return psi
}

function groupOf(fieldName: string): string {
  return classifyFieldType(fieldName) ?? OTHER_GROUP
}

function accuracy(labels: DriftLabel[]): number | null {
  if (labels.length === 0) return null
  return labels.filter(l => l.wasCorrect).length / labels.length
}

/**
 * Split each field group's labels into a recent window (newest `recentWindow`)
 * and a baseline (everything older), then measure degradation and drift. A group
 * is judged only when both windows carry at least `minSamples` labels.
 */
export function evaluateAccuracyDrift(
  labels: DriftLabel[],
  opts: { recentWindow?: number; minSamples?: number } = {},
): DriftReport {
  const recentWindow = opts.recentWindow ?? DEFAULT_RECENT_WINDOW
  const minSamples = opts.minSamples ?? DEFAULT_MIN_SAMPLES

  const byGroup = new Map<string, DriftLabel[]>()
  for (const label of labels) {
    const g = groupOf(label.fieldName)
    const bucket = byGroup.get(g)
    if (bucket) bucket.push(label)
    else byGroup.set(g, [label])
  }

  const groups: GroupDrift[] = []
  for (const [group, groupLabels] of byGroup) {
    // Newest first, so the head is the recent window and the tail the baseline.
    const sorted = [...groupLabels].sort((a, b) => b.createdAt - a.createdAt)
    const recent = sorted.slice(0, recentWindow)
    const baseline = sorted.slice(recentWindow)

    const recentAccuracy = accuracy(recent)
    const baselineAccuracy = accuracy(baseline)
    const accuracyDelta =
      recentAccuracy !== null && baselineAccuracy !== null
        ? recentAccuracy - baselineAccuracy
        : null

    const confidencePsi =
      recent.length > 0 && baseline.length > 0
        ? populationStabilityIndex(
            baseline.map(l => l.confidenceAtExtraction),
            recent.map(l => l.confidenceAtExtraction),
          )
        : null

    const sufficient = recent.length >= minSamples && baseline.length >= minSamples
    const accuracyDegraded =
      sufficient && accuracyDelta !== null && accuracyDelta <= -ACCURACY_DROP_THRESHOLD
    const confidenceDrift =
      sufficient && confidencePsi !== null && confidencePsi >= PSI_DRIFT_THRESHOLD

    groups.push({
      group,
      isKillSignalGroup: KILL_SIGNAL_SET.has(group),
      recentN: recent.length,
      baselineN: baseline.length,
      recentAccuracy,
      baselineAccuracy,
      accuracyDelta,
      confidencePsi,
      sufficient,
      accuracyDegraded,
      confidenceDrift,
    })
  }

  groups.sort((a, b) => a.group.localeCompare(b.group))
  return { groups, degraded: groups.some(g => g.accuracyDegraded || g.confidenceDrift) }
}
