// Per-call observability for the brain seam.
//
// Every call to the brain emits one metric — latency, outcome, endpoint — so we
// can watch the "down ⇒ degrade, never block" invariant in production and alert
// on rising timeout/error/degraded rates. The sink is pluggable and defaults to
// a no-op, so libraries stay decoupled from whatever telemetry backend the app
// wires in (log line, StatsD, OTel, etc.).

export type BrainOutcome =
  | 'ok' // 2xx response
  | 'timeout' // request aborted on the client timeout
  | 'error' // network failure or non-2xx response
  | 'degraded' // brain not configured — call skipped

export interface BrainCallMetric {
  endpoint: string
  outcome: BrainOutcome
  latencyMs: number
}

export type BrainMetricSink = (metric: BrainCallMetric) => void

let sink: BrainMetricSink = () => {}

/** Install the process-wide metric sink (call once at app startup). */
export function setBrainMetricSink(next: BrainMetricSink): void {
  sink = next
}

/** Emit one call metric. Never throws — observability must not break the caller. */
export function emitBrainMetric(metric: BrainCallMetric): void {
  try {
    sink(metric)
  } catch {
    // A broken sink must never affect the brain call it is measuring.
  }
}
