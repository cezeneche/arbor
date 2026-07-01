import { applyCalibrationMap, wilsonInterval, buildPosterior } from '../posterior'
import type { GroupCalibration } from '@/lib/brain/types'

// Step 5 core (Upgrade 1). The brain returns a calibration map (isotonic knots)
// plus a reliability diagram per group. The ingestion/backfill path applies the
// map itself — no runtime dependency on the brain — turning a raw model score
// into a calibrated posterior with a credible interval. These are the pure
// pieces the offline calibration job composes; the map interpolation mirrors the
// Python apply_calibration so both ends agree.

describe('applyCalibrationMap', () => {
  it('returns the raw score when the map is empty', () => {
    expect(applyCalibrationMap({ method: 'isotonic', x: [], y: [] }, 0.42)).toBe(0.42)
  })

  it('clips below the first knot and above the last', () => {
    const map = { method: 'isotonic', x: [0.2, 0.8], y: [0.1, 0.9] }
    expect(applyCalibrationMap(map, 0.0)).toBe(0.1)
    expect(applyCalibrationMap(map, 1.0)).toBe(0.9)
  })

  it('interpolates linearly between knots (matches Python apply_calibration)', () => {
    const map = { method: 'isotonic', x: [0.2, 0.6], y: [0.1, 0.9] }
    // midpoint 0.4 -> halfway between 0.1 and 0.9 = 0.5
    expect(applyCalibrationMap(map, 0.4)).toBeCloseTo(0.5, 10)
  })
})

describe('wilsonInterval', () => {
  it('is symmetric-ish around p and narrows as n grows', () => {
    const wide = wilsonInterval(0.8, 10, 1.645)
    const narrow = wilsonInterval(0.8, 1000, 1.645)
    expect(wide.high - wide.low).toBeGreaterThan(narrow.high - narrow.low)
    for (const iv of [wide, narrow]) {
      expect(iv.low).toBeGreaterThanOrEqual(0)
      expect(iv.high).toBeLessThanOrEqual(1)
      expect(iv.low).toBeLessThanOrEqual(iv.high)
    }
  })

  it('a zero-sample bin returns the whole [0,1] range (maximal uncertainty)', () => {
    expect(wilsonInterval(0, 0, 1.645)).toEqual({ low: 0, high: 1 })
  })
})

describe('buildPosterior', () => {
  const group: GroupCalibration = {
    group: 'mass',
    n: 40,
    brier: 0.1,
    ece: 0.03,
    reliability: [
      { bin_lower: 0.0, bin_upper: 0.5, mean_predicted: 0.3, empirical_accuracy: 0.4, count: 10 },
      { bin_lower: 0.5, bin_upper: 1.0, mean_predicted: 0.8, empirical_accuracy: 0.7, count: 30 },
    ],
    calibration_map: { method: 'isotonic', x: [0.3, 0.8], y: [0.4, 0.7] },
    sufficient: true,
  }

  it('produces a calibrated posterior with a credible interval bracketing the mean', () => {
    const p = buildPosterior(0.8, group)
    expect(p.rawScore).toBe(0.8)
    expect(p.method).toBe('isotonic')
    expect(p.priorClass).toBe('mass')
    expect(p.ciMass).toBe(0.9)
    // 0.8 maps to the top knot -> 0.7 calibrated.
    expect(p.posteriorMean).toBeCloseTo(0.7, 10)
    expect(p.ciLow).toBeLessThanOrEqual(p.posteriorMean)
    expect(p.ciHigh).toBeGreaterThanOrEqual(p.posteriorMean)
    expect(p.ciLow).toBeGreaterThanOrEqual(0)
    expect(p.ciHigh).toBeLessThanOrEqual(1)
  })

  it('widens the interval when the covering bin has few samples', () => {
    const sparse: GroupCalibration = {
      ...group,
      reliability: [
        { bin_lower: 0.5, bin_upper: 1.0, mean_predicted: 0.8, empirical_accuracy: 0.7, count: 2 },
      ],
    }
    const dense = buildPosterior(0.8, group)
    const thin = buildPosterior(0.8, sparse)
    expect(thin.ciHigh - thin.ciLow).toBeGreaterThan(dense.ciHigh - dense.ciLow)
  })
})
