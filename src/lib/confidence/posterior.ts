// Step 5 core. Pure: no DB, no network.
//
// The brain fits a calibration map (isotonic knots) and reliability diagram per
// group and hands them back; the ingestion/backfill path applies them here to
// turn a raw model score into a calibrated posterior with a credible interval —
// the value we store in DataRecord.confidencePosterior. Applying the map on this
// side (rather than calling the brain per record) is deliberate: calibration
// must keep working even when the brain is down.

import type { CalibrationMap, GroupCalibration } from '@/lib/brain/types'
import type { ConfidencePosterior } from './types'

/** 90% credible interval by default (z ≈ 1.645). */
const DEFAULT_CI_MASS = 0.9
const DEFAULT_Z = 1.645

/**
 * Apply an isotonic calibration map to a raw score via clipped piecewise-linear
 * interpolation. Mirrors the Python apply_calibration so both ends agree.
 */
export function applyCalibrationMap(map: CalibrationMap, score: number): number {
  const { x, y } = map
  if (x.length === 0) return score
  if (score <= x[0]) return y[0]
  if (score >= x[x.length - 1]) return y[y.length - 1]
  for (let i = 1; i < x.length; i++) {
    if (score <= x[i]) {
      const x0 = x[i - 1]
      const x1 = x[i]
      const y0 = y[i - 1]
      const y1 = y[i]
      if (x1 === x0) return y1
      const t = (score - x0) / (x1 - x0)
      return y0 + t * (y1 - y0)
    }
  }
  return y[y.length - 1]
}

export interface Interval {
  low: number
  high: number
}

/**
 * Wilson score interval for a binomial proportion — the credible interval for a
 * reliability bin's empirical accuracy. A zero-sample bin carries no information,
 * so its interval is the whole [0, 1]. Well-behaved at p = 0 and p = 1, unlike
 * the normal approximation.
 */
export function wilsonInterval(p: number, n: number, z = DEFAULT_Z): Interval {
  if (n <= 0) return { low: 0, high: 1 }
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denom
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return {
    low: Math.max(0, centre - margin),
    high: Math.min(1, centre + margin),
  }
}

/** Find the reliability bin covering `score`, or null if none does. */
function coveringBin(group: GroupCalibration, score: number) {
  return (
    group.reliability.find(
      b => score >= b.bin_lower && (score < b.bin_upper || b.bin_upper >= 1),
    ) ?? null
  )
}

/**
 * Build the calibrated posterior for one raw score under a group's fitted
 * calibration. Point estimate is the calibrated value from the isotonic map;
 * the credible interval is the Wilson interval of the covering reliability bin's
 * empirical accuracy (its width reflects how much data backs that region).
 */
export function buildPosterior(
  rawScore: number,
  group: GroupCalibration,
  opts: { ciMass?: number; z?: number } = {},
): ConfidencePosterior {
  const posteriorMean = applyCalibrationMap(group.calibration_map, rawScore)
  const bin = coveringBin(group, rawScore)
  const interval = bin
    ? wilsonInterval(bin.empirical_accuracy, bin.count, opts.z ?? DEFAULT_Z)
    : { low: 0, high: 1 }

  return {
    posteriorMean,
    ciLow: Math.min(interval.low, posteriorMean),
    ciHigh: Math.max(interval.high, posteriorMean),
    ciMass: opts.ciMass ?? DEFAULT_CI_MASS,
    method: group.calibration_map.method,
    priorClass: group.group,
    rawScore,
  }
}
