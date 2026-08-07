import { trustDisplay, TRUST_HIGH, TRUST_MODERATE, WIDE_INTERVAL } from '../trust-display'
import type { ConfidencePosterior } from '../types'

// miscalibration-first UX. The pure classifier every field-level UI
// consumes: it turns a field's confidence state into a display band, and decides
// when a field must visually break the user's scanning pattern. It prefers the
// *calibrated* posterior over the raw model score, and treats an honest wide
// credible interval as a reason to distrust even a high point estimate.

function posterior(over: Partial<ConfidencePosterior>): ConfidencePosterior {
  return {
    posteriorMean: 0.9,
    ciLow: 0.85,
    ciHigh: 0.95,
    ciMass: 0.9,
    method: 'isotonic',
    priorClass: 'mass',
    rawScore: 0.9,
    ...over,
  }
}

describe('trustDisplay', () => {
  it('uses the calibrated posterior mean over the raw score when present', () => {
    const d = trustDisplay({ confidenceScore: 0.99, confidencePosterior: posterior({ posteriorMean: 0.7 }) })
    expect(d.value).toBe(0.7)
    expect(d.calibrated).toBe(true)
    expect(d.interval).toEqual({ low: 0.85, high: 0.95, mass: 0.9 })
  })

  it('falls back to the raw score when no posterior exists', () => {
    const d = trustDisplay({ confidenceScore: 0.72 })
    expect(d.value).toBe(0.72)
    expect(d.calibrated).toBe(false)
    expect(d.interval).toBeNull()
  })

  it('bands high / moderate / low by the calibrated value', () => {
    expect(trustDisplay({ confidenceScore: TRUST_HIGH }).band).toBe('high')
    expect(trustDisplay({ confidenceScore: TRUST_MODERATE }).band).toBe('moderate')
    expect(trustDisplay({ confidenceScore: TRUST_MODERATE - 0.01 }).band).toBe('low')
  })

  it('breaks the scanning pattern for low-confidence fields', () => {
    expect(trustDisplay({ confidenceScore: 0.4 }).breaksPattern).toBe(true)
    expect(trustDisplay({ confidenceScore: 0.95 }).breaksPattern).toBe(false)
  })

  it('downgrades a high mean with a wide credible interval (honest uncertainty)', () => {
    // Mean 0.9 but a very wide interval — the estimate is not trustworthy.
    const d = trustDisplay({
      confidenceScore: 0.9,
      confidencePosterior: posterior({ posteriorMean: 0.9, ciLow: 0.3, ciHigh: 1.0 }),
    })
    expect(d.band).toBe('moderate') // capped down from high
    expect(d.breaksPattern).toBe(true)
  })

  it('treats a manually confirmed field (score = 1) as human-verified, not model confidence', () => {
    const d = trustDisplay({ confidenceScore: 1 })
    expect(d.band).toBe('high')
    expect(d.manual).toBe(true)
    expect(d.calibrated).toBe(false)
    expect(d.breaksPattern).toBe(false)
  })

  it('carries a plain-English summary for every band', () => {
    expect(trustDisplay({ confidenceScore: 0.95 }).summary).toMatch(/\S/)
    expect(trustDisplay({ confidenceScore: 0.7 }).summary).toMatch(/\S/)
    expect(trustDisplay({ confidenceScore: 0.3 }).summary).toMatch(/review/i)
  })

  it('exposes the wide-interval threshold used', () => {
    expect(WIDE_INTERVAL).toBeGreaterThan(0)
    expect(WIDE_INTERVAL).toBeLessThan(1)
  })
})

// ── the "Moderate · 100%" contradiction ──────────────────────────────────────
describe('overruled point estimates', () => {
  it('flags a point estimate the band overruled', () => {
    // 100% certain on the strength of one observation: the classifier downgrades
    // it, so the UI must not go on printing 100%.
    const t = trustDisplay({
      confidenceScore: 1,
      confidencePosterior: {
        posteriorMean: 1, ciLow: 0.55, ciHigh: 1, ciMass: 0.9,
        method: 'beta', priorClass: 'n=1', rawScore: 1,
      },
    })
    expect(t.band).toBe('moderate')
    expect(t.overruled).toBe(true)
  })

  it('does not flag a band that was never downgraded', () => {
    const t = trustDisplay({
      confidenceScore: 0.7,
      confidencePosterior: {
        posteriorMean: 0.7, ciLow: 0.66, ciHigh: 0.74, ciMass: 0.9,
        method: 'beta', priorClass: 'n=40', rawScore: 0.7,
      },
    })
    expect(t.band).toBe('moderate')
    expect(t.overruled).toBe(false)
  })

  it('does not flag a manually entered value', () => {
    expect(trustDisplay({ confidenceScore: 1 }).overruled).toBe(false)
  })

  it('describes a manual value by where it came from, not as a confidence grade', () => {
    // "Confirmed" sat beside a Verified / Declared badge and read as the same
    // scale, and as stronger than Declared.
    const t = trustDisplay({ confidenceScore: 1 })
    expect(t.summary).toMatch(/entered by you/i)
    expect(t.summary).not.toMatch(/^Confirmed$/)
  })
})
