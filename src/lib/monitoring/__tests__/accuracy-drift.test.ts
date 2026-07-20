import {
  populationStabilityIndex,
  evaluateAccuracyDrift,
  ACCURACY_DROP_THRESHOLD,
  PSI_DRIFT_THRESHOLD,
  type DriftLabel,
} from '../accuracy-drift'

// Accuracy & drift monitor (MLOps guardrail). Pure: no DB, no network.
//
// Calibration ECE tells us whether the model's *confidence* is honest. It does
// NOT tell us whether extraction is *correct*, nor whether the input mix has
// drifted. This module measures both from the ground-truth stream:
//   - correct-rate now vs the historical baseline, per field group (degradation)
//   - the confidence-distribution shift (PSI) between the two (drift)
// A verdict is only issued once both windows have enough labels to trust — a
// thin window is reported but never judged, mirroring the calibration kill signal.

// A label whose fieldName lands in a kill-signal group ('mass' here).
function mass(createdAt: number, wasCorrect: boolean, conf: number): DriftLabel {
  return { fieldName: 'shipment_weight', wasCorrect, confidenceAtExtraction: conf, createdAt }
}

describe('populationStabilityIndex', () => {
  it('is zero for identical distributions', () => {
    const xs = [0.1, 0.4, 0.6, 0.9]
    expect(populationStabilityIndex(xs, xs, 2)).toBeCloseTo(0, 10)
  })

  it('matches a hand-computed value for a known shift (2 bins)', () => {
    // baseline lands 2 in [0,0.5) and 2 in [0.5,1] -> proportions [0.5, 0.5]
    // recent lands 3 in [0,0.5) and 1 in [0.5,1]  -> proportions [0.75, 0.25]
    // PSI = 0.25*ln(1.5) + (-0.25)*ln(0.5) = 0.274653...
    const baseline = [0.1, 0.4, 0.6, 0.9]
    const recent = [0.1, 0.2, 0.3, 0.9]
    expect(populationStabilityIndex(baseline, recent, 2)).toBeCloseTo(0.274653, 5)
  })

  it('returns 0 when either window is empty (nothing to compare)', () => {
    expect(populationStabilityIndex([], [0.5], 10)).toBe(0)
    expect(populationStabilityIndex([0.5], [], 10)).toBe(0)
  })

  it('grows as the shift grows (monotone in divergence)', () => {
    const baseline = Array.from({ length: 20 }, () => 0.5)
    const small = [...Array(18).fill(0.5), 0.1, 0.1]
    const large = Array.from({ length: 20 }, () => 0.05)
    expect(populationStabilityIndex(baseline, large, 10)).toBeGreaterThan(
      populationStabilityIndex(baseline, small, 10),
    )
  })
})

describe('evaluateAccuracyDrift', () => {
  const opts = { recentWindow: 5, minSamples: 5 }

  it('flags a group whose recent correct-rate dropped past the threshold', () => {
    const labels: DriftLabel[] = [
      // baseline (older, createdAt 1..5): all correct
      ...[1, 2, 3, 4, 5].map(t => mass(t, true, 0.8)),
      // recent (newer, createdAt 6..10): 1/5 correct -> delta = 0.2 - 1.0 = -0.8
      mass(6, true, 0.8), mass(7, false, 0.8), mass(8, false, 0.8), mass(9, false, 0.8), mass(10, false, 0.8),
    ]
    const report = evaluateAccuracyDrift(labels, opts)
    const g = report.groups.find(x => x.group === 'mass')!
    expect(g.sufficient).toBe(true)
    expect(g.recentAccuracy).toBeCloseTo(0.2, 10)
    expect(g.baselineAccuracy).toBeCloseTo(1.0, 10)
    expect(g.accuracyDelta).toBeLessThanOrEqual(-ACCURACY_DROP_THRESHOLD)
    expect(g.accuracyDegraded).toBe(true)
    expect(g.isKillSignalGroup).toBe(true)
    expect(report.degraded).toBe(true)
  })

  it('does not judge a group whose windows are too thin, even if accuracy differs', () => {
    const labels: DriftLabel[] = [
      mass(1, true, 0.8), mass(2, true, 0.8),
      mass(3, false, 0.8), mass(4, false, 0.8), // only 4 total -> baseline < minSamples
    ]
    const report = evaluateAccuracyDrift(labels, opts)
    const g = report.groups.find(x => x.group === 'mass')!
    expect(g.sufficient).toBe(false)
    expect(g.accuracyDegraded).toBe(false)
    expect(report.degraded).toBe(false)
  })

  it('flags confidence drift when the distribution shifts but accuracy holds', () => {
    const labels: DriftLabel[] = [
      // baseline confident (~0.9), all correct
      ...[1, 2, 3, 4, 5].map(t => mass(t, true, 0.9)),
      // recent low-confidence (~0.2), still all correct -> accuracy stable, PSI large
      ...[6, 7, 8, 9, 10].map(t => mass(t, true, 0.2)),
    ]
    const report = evaluateAccuracyDrift(labels, opts)
    const g = report.groups.find(x => x.group === 'mass')!
    expect(g.accuracyDegraded).toBe(false)
    expect(g.confidencePsi).toBeGreaterThanOrEqual(PSI_DRIFT_THRESHOLD)
    expect(g.confidenceDrift).toBe(true)
    expect(report.degraded).toBe(true)
  })

  it('reports a stable group as neither degraded nor drifted', () => {
    const labels: DriftLabel[] = Array.from({ length: 12 }, (_, i) => mass(i + 1, true, 0.8))
    const report = evaluateAccuracyDrift(labels, opts)
    const g = report.groups.find(x => x.group === 'mass')!
    expect(g.sufficient).toBe(true)
    expect(g.accuracyDegraded).toBe(false)
    expect(g.confidenceDrift).toBe(false)
    expect(report.degraded).toBe(false)
  })

  it('buckets uncategorised field names into "other", not a kill-signal group', () => {
    const labels: DriftLabel[] = Array.from({ length: 12 }, (_, i) => ({
      fieldName: 'invoice_number',
      wasCorrect: true,
      confidenceAtExtraction: 0.8,
      createdAt: i + 1,
    }))
    const report = evaluateAccuracyDrift(labels, opts)
    const g = report.groups.find(x => x.group === 'other')!
    expect(g).toBeDefined()
    expect(g.isKillSignalGroup).toBe(false)
  })
})
