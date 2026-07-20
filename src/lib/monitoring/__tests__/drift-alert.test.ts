import {
  shouldAlert,
  buildCalibrationAlert,
  buildAccuracyAlert,
} from '../drift-alert'

// Drift alerting (MLOps guardrail). Pure: no DB, no network.
//
// The calibration kill signal and the accuracy/drift monitor already compute and
// persist a breach flag — but a number in a table nobody is paged on is not
// monitoring. This module decides WHEN to alert and WHAT the payload says. The
// dispatch (a fail-soft webhook POST) lives in drift-alert-dispatch.ts.

describe('shouldAlert (edge-trigger)', () => {
  it('alerts on a transition into breach', () => {
    expect(shouldAlert(true, false)).toBe(true)
  })
  it('alerts on the first breach when there is no previous run', () => {
    expect(shouldAlert(true, null)).toBe(true)
  })
  it('stays quiet while a breach persists (known ongoing incident, not new)', () => {
    expect(shouldAlert(true, true)).toBe(false)
  })
  it('does not alert when not breached', () => {
    expect(shouldAlert(false, true)).toBe(false)
    expect(shouldAlert(false, false)).toBe(false)
    expect(shouldAlert(false, null)).toBe(false)
  })
})

describe('buildCalibrationAlert', () => {
  const now = new Date('2026-07-20T03:00:00.000Z')

  it('names only the breached groups and stamps the run + time', () => {
    const alert = buildCalibrationAlert(
      'run_1',
      [
        { group: 'mass', ece: 0.09, n: 120, breached: true },
        { group: 'supplier_identity', ece: 0.02, n: 80, breached: false },
      ],
      now,
    )
    expect(alert.signal).toBe('calibration')
    expect(alert.runId).toBe('run_1')
    expect(alert.breachedAt).toBe('2026-07-20T03:00:00.000Z')
    expect(alert.groups.map(g => g.group)).toEqual(['mass'])
    expect(alert.summary).toContain('mass')
    expect(alert.summary.toLowerCase()).toContain('calibration')
  })
})

describe('buildAccuracyAlert', () => {
  const now = new Date('2026-07-20T03:30:00.000Z')

  it('includes both degraded and drifted groups, and describes why', () => {
    const alert = buildAccuracyAlert(
      'run_2',
      [
        { group: 'mass', accuracyDelta: -0.22, confidencePsi: 0.05, accuracyDegraded: true, confidenceDrift: false },
        { group: 'emissions_intensity', accuracyDelta: 0.0, confidencePsi: 0.31, accuracyDegraded: false, confidenceDrift: true },
        { group: 'other', accuracyDelta: -0.01, confidencePsi: 0.02, accuracyDegraded: false, confidenceDrift: false },
      ],
      now,
    )
    expect(alert.signal).toBe('accuracy')
    expect(alert.groups.map(g => g.group).sort()).toEqual(['emissions_intensity', 'mass'])
    const mass = alert.groups.find(g => g.group === 'mass')!
    expect(mass.detail.toLowerCase()).toContain('accuracy')
    const emi = alert.groups.find(g => g.group === 'emissions_intensity')!
    expect(emi.detail.toLowerCase()).toContain('psi')
  })
})
