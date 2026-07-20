// Fail-soft drift-alert dispatch. Impure (network) — kept out of the pure
// ./drift-alert module so the alert logic stays unit-testable.
//
// Guarantees: an alert dispatch NEVER breaks the cron that raised it. No webhook
// configured → no-op; a network or non-2xx response → swallowed and reported,
// never thrown. The breach is always persisted (AccuracyRun / CalibrationRun) and
// readable on the admin health endpoints regardless — this webhook is the push,
// not the record.
import type { DriftAlert } from './drift-alert'

export interface AlertDispatchResult {
  sent: boolean
  /** 'not-configured' | 'error' | `http_${status}` when not sent. */
  reason?: string
}

export interface DispatchDeps {
  /** Override the sink URL; defaults to DRIFT_ALERT_WEBHOOK_URL. */
  webhookUrl?: string | null
  /** Injectable for hermetic tests. */
  fetchImpl?: typeof fetch
}

export async function dispatchDriftAlert(
  alert: DriftAlert,
  deps: DispatchDeps = {},
): Promise<AlertDispatchResult> {
  const url = deps.webhookUrl ?? process.env.DRIFT_ALERT_WEBHOOK_URL ?? null
  if (!url) return { sent: false, reason: 'not-configured' }

  const doFetch = deps.fetchImpl ?? fetch
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `text` renders out-of-the-box in a Slack incoming webhook; the structured
      // alert fields ride alongside for PagerDuty / generic JSON sinks.
      body: JSON.stringify({ text: `[Arbor drift] ${alert.summary}`, ...alert }),
    })
    if (!res.ok) return { sent: false, reason: `http_${res.status}` }
    return { sent: true }
  } catch {
    return { sent: false, reason: 'error' }
  }
}
