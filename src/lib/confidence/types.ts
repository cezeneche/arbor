// Bayesian fusion + calibration.
//
// The calibrated posterior that rides alongside every field's stored value.
// Persisted as the JSONB `confidencePosterior` sidecar on DataRecord. The raw
// scalar `confidenceScore` stays for back-compat; this is the audit-defensible
// version — a calibrated point estimate with a stated credible interval.

export interface ConfidencePosterior {
  /** Calibrated point estimate P(value correct) in [0, 1]. */
  posteriorMean: number
  /** Lower bound of the credible interval, in [0, 1]. */
  ciLow: number
  /** Upper bound of the credible interval, in [0, 1]. */
  ciHigh: number
  /** Credible mass the interval covers, e.g. 0.9 for a 90% interval. */
  ciMass: number
  /** How the posterior was produced, e.g. 'beta-binomial' | 'isotonic' | 'platt'. */
  method: string
  /** Conjugate-prior class the fusion used, e.g. the document class. */
  priorClass: string
  /** The uncalibrated model score this posterior was derived from. */
  rawScore: number
}
