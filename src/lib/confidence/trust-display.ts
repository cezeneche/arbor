// miscalibration-first UX, display classifier. Pure: no DB, no React.
//
// Skitka's finding is the whole reason this upgrade exists: miscalibrated trust
// is worse than no automation. Every other upgrade produces calibrated numbers;
// this is where the UI is forced to respect them. This function is the single
// source of truth for how a field's confidence is shown — so a low-confidence
// field can never accidentally render identically to a high-confidence one.
//
// Two principles it encodes:
//   1. Prefer the *calibrated* posterior over the raw model score —
//      the calibrated number is the one empirically tied to real accuracy.
//   2. Honest uncertainty counts: a high point estimate with a wide credible
//      interval (e.g. the n=1 case) is not trustworthy, so it is downgraded and
//      made to break the scanning pattern anyway.

import type { ConfidencePosterior } from './types'

/** At/above this calibrated value a field reads as high confidence. */
export const TRUST_HIGH = 0.85
/** At/above this it is moderate; below it is low (must be reviewed). */
export const TRUST_MODERATE = 0.6
/** A credible interval at least this wide is treated as untrustworthy. */
export const WIDE_INTERVAL = 0.4

export type TrustBand = 'high' | 'moderate' | 'low'

export interface TrustDisplay {
  band: TrustBand
  /** The value shown, in [0, 1] — the calibrated mean when available, else raw. */
  value: number
  /** True when `value` is the calibrated posterior rather than the raw model score. */
  calibrated: boolean
  /** True when the field was confirmed by a human (not a model estimate at all). */
  manual: boolean
  /** The credible interval, when a calibrated posterior is present. */
  interval: { low: number; high: number; mass: number } | null
  /** True when the UI must visually break the scanning pattern for this field. */
  breaksPattern: boolean
  /** Plain-English one-liner for the field. */
  summary: string
}

export interface TrustDisplayInput {
  /** The raw scalar confidence; 1.0 conventionally means manually confirmed. */
  confidenceScore: number
  /** The calibrated posterior sidecar, when the calibration pipeline has run. */
  confidencePosterior?: ConfidencePosterior | null
}

const SUMMARIES: Record<TrustBand, string> = {
  high: 'High confidence',
  moderate: 'Moderate confidence — worth a check',
  low: 'Low confidence — please review',
}

export function trustDisplay(input: TrustDisplayInput): TrustDisplay {
  // A manually confirmed field is human-verified, not a model estimate.
  if (input.confidenceScore >= 1 && !input.confidencePosterior) {
    return {
      band: 'high',
      value: 1,
      calibrated: false,
      manual: true,
      interval: null,
      breaksPattern: false,
      summary: 'Confirmed by you',
    }
  }

  const posterior = input.confidencePosterior ?? null
  const value = posterior ? posterior.posteriorMean : input.confidenceScore
  const interval = posterior
    ? { low: posterior.ciLow, high: posterior.ciHigh, mass: posterior.ciMass }
    : null
  const wide = interval !== null && interval.high - interval.low >= WIDE_INTERVAL

  let band: TrustBand = value >= TRUST_HIGH ? 'high' : value >= TRUST_MODERATE ? 'moderate' : 'low'
  // Honest uncertainty: a wide interval never reads as high confidence.
  if (wide && band === 'high') band = 'moderate'

  return {
    band,
    value,
    calibrated: posterior !== null,
    manual: false,
    interval,
    breaksPattern: band === 'low' || wide,
    summary: SUMMARIES[band],
  }
}
