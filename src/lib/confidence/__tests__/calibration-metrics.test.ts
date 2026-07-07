import {
  evaluateCalibrationRun,
  KILL_SIGNAL_GROUPS,
  ECE_KILL_THRESHOLD,
} from '../calibration-metrics'
import type { GroupCalibration } from '@/lib/brain/types'

// measurement loop. Turn the brain's per-group calibration report
// into persistable headline metrics and evaluate the plan's kill signal:
// ECE < 5% for the three kill-signal field types (supplier identity, mass,
// emissions intensity), judged only once a group has enough labels to trust.
// Pure — the cron route persists what this returns.

function group(overrides: Partial<GroupCalibration> & { group: string }): GroupCalibration {
  return {
    n: 40,
    brier: 0.1,
    ece: 0.02,
    reliability: [],
    calibration_map: { method: 'isotonic', x: [], y: [] },
    sufficient: true,
    ...overrides,
  }
}

describe('kill-signal constants', () => {
  it('tracks exactly the three plan-defined kill-signal field types', () => {
    expect([...KILL_SIGNAL_GROUPS].sort()).toEqual(
      ['emissions_intensity', 'mass', 'supplier_identity'].sort(),
    )
  })

  it('uses the plan threshold of 5% ECE', () => {
    expect(ECE_KILL_THRESHOLD).toBe(0.05)
  })
})

describe('evaluateCalibrationRun', () => {
  it('flags kill-signal groups and passes through headline metrics', () => {
    const { metrics } = evaluateCalibrationRun([
      group({ group: 'mass', ece: 0.03, brier: 0.09, n: 50 }),
      group({ group: 'invoice_number', ece: 0.2, n: 50 }),
    ])
    const mass = metrics.find(m => m.group === 'mass')!
    const other = metrics.find(m => m.group === 'invoice_number')!

    expect(mass.isKillSignalGroup).toBe(true)
    expect(mass.ece).toBe(0.03)
    expect(mass.brier).toBe(0.09)
    expect(mass.n).toBe(50)
    // A non-kill-signal group is never a breach however bad its ECE.
    expect(other.isKillSignalGroup).toBe(false)
    expect(other.breached).toBe(false)
  })

  it('breaches when a sufficient kill-signal group exceeds the ECE threshold', () => {
    const { metrics, killSignalBreached } = evaluateCalibrationRun([
      group({ group: 'supplier_identity', ece: 0.08, sufficient: true, n: 60 }),
    ])
    expect(metrics[0].breached).toBe(true)
    expect(killSignalBreached).toBe(true)
  })

  it('does not breach a kill-signal group that is under the threshold', () => {
    const { metrics, killSignalBreached } = evaluateCalibrationRun([
      group({ group: 'mass', ece: ECE_KILL_THRESHOLD, sufficient: true, n: 60 }),
    ])
    // Exactly at threshold is acceptable (breach is strictly greater than).
    expect(metrics[0].breached).toBe(false)
    expect(killSignalBreached).toBe(false)
  })

  it('never breaches on an insufficient group — too few labels to judge calibration', () => {
    const { metrics, killSignalBreached } = evaluateCalibrationRun([
      group({ group: 'mass', ece: 0.4, sufficient: false, n: 3 }),
    ])
    expect(metrics[0].isKillSignalGroup).toBe(true)
    expect(metrics[0].breached).toBe(false)
    expect(killSignalBreached).toBe(false)
  })

  it('never breaches when ECE is null (unmeasurable)', () => {
    const { metrics, killSignalBreached } = evaluateCalibrationRun([
      group({ group: 'mass', ece: null, sufficient: true, n: 60 }),
    ])
    expect(metrics[0].breached).toBe(false)
    expect(killSignalBreached).toBe(false)
  })

  it('breaches the run if any one kill-signal group breaches', () => {
    const { killSignalBreached } = evaluateCalibrationRun([
      group({ group: 'mass', ece: 0.01, sufficient: true }),
      group({ group: 'emissions_intensity', ece: 0.09, sufficient: true }),
      group({ group: 'supplier_identity', ece: 0.02, sufficient: true }),
    ])
    expect(killSignalBreached).toBe(true)
  })

  it('reports no breach for an empty run', () => {
    const { metrics, killSignalBreached } = evaluateCalibrationRun([])
    expect(metrics).toEqual([])
    expect(killSignalBreached).toBe(false)
  })
})
