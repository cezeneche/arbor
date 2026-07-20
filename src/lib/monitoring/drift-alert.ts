// Drift alerting (MLOps guardrail). Pure: no DB, no network.
//
// Measurement you are not paged on is not monitoring. The calibration kill signal
// and the accuracy/drift monitor each persist a breach flag; this module decides
// WHEN a breach warrants an alert and builds the payload. The dispatch itself (a
// fail-soft webhook POST) lives in ./drift-alert-dispatch.
//
// Edge-triggering is deliberate: alert only on the transition INTO breach. A
// breach that persists across daily runs is a known, ongoing incident — paging on
// it every 24h trains responders to ignore the channel.

export type DriftSignal = 'calibration' | 'accuracy'

export interface DriftAlertGroup {
  group: string
  detail: string
}

export interface DriftAlert {
  signal: DriftSignal
  runId: string
  summary: string
  groups: DriftAlertGroup[]
  breachedAt: string
}

/**
 * Alert only when this run breaches and the previous run did not (or there was
 * no previous run). `previous` is null when no prior run exists.
 */
export function shouldAlert(current: boolean, previous: boolean | null): boolean {
  return current === true && previous !== true
}

function pct(x: number | null): string {
  return x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`
}

function signed(x: number | null): string {
  if (x === null) return 'n/a'
  const p = (x * 100).toFixed(1)
  return x > 0 ? `+${p}pp` : `${p}pp`
}

function num(x: number | null): string {
  return x === null ? 'n/a' : x.toFixed(2)
}

export interface CalibrationBreachGroup {
  group: string
  ece: number | null
  n: number
  breached: boolean
}

/** Build the alert for a calibration kill-signal breach (ECE over threshold). */
export function buildCalibrationAlert(
  runId: string,
  groups: CalibrationBreachGroup[],
  now: Date,
): DriftAlert {
  const tripped = groups.filter(g => g.breached)
  const names = tripped.map(g => g.group).join(', ')
  return {
    signal: 'calibration',
    runId,
    breachedAt: now.toISOString(),
    groups: tripped.map(g => ({
      group: g.group,
      detail: `ECE ${pct(g.ece)} over threshold (n=${g.n})`,
    })),
    summary: `Calibration kill signal breached — ${names || 'kill-signal group'} above the ECE ceiling`,
  }
}

export interface AccuracyDriftGroup {
  group: string
  accuracyDelta: number | null
  confidencePsi: number | null
  accuracyDegraded: boolean
  confidenceDrift: boolean
}

/** Build the alert for an accuracy-degradation and/or confidence-drift breach. */
export function buildAccuracyAlert(
  runId: string,
  groups: AccuracyDriftGroup[],
  now: Date,
): DriftAlert {
  const tripped = groups.filter(g => g.accuracyDegraded || g.confidenceDrift)
  const names = tripped.map(g => g.group).join(', ')
  return {
    signal: 'accuracy',
    runId,
    breachedAt: now.toISOString(),
    groups: tripped.map(g => ({
      group: g.group,
      detail: [
        g.accuracyDegraded ? `accuracy ${signed(g.accuracyDelta)} vs baseline` : null,
        g.confidenceDrift ? `confidence PSI ${num(g.confidencePsi)}` : null,
      ]
        .filter(Boolean)
        .join(', '),
    })),
    summary: `Extraction accuracy/drift alarm — ${names || 'field group'} degraded or drifted`,
  }
}
