// Fail-soft drift-alert dispatch. Impure (network) — kept out of the pure
// ./drift-alert module so the alert logic stays unit-testable.
//
// Guarantees: an alert dispatch NEVER breaks the cron that raised it. No channel
// configured → no-op; a network or non-2xx response → reported, never thrown.
// The breach is always persisted (AccuracyRun / CalibrationRun) and readable on
// the admin health endpoints regardless — this alert is the push, not the record.
//
// Sent in the house style (contract/alerts) as a warning: Slack, to
// DRIFT_ALERT_WEBHOOK_URL when set or else the ops channel, and email to the
// platform admins.
import { arborAlert, sendAlert, type SendDeps } from '@/lib/alerts/send'
import type { Alert } from '@/lib/alerts/format'
import type { DriftAlert } from './drift-alert'

export interface AlertDispatchResult {
  sent: boolean
  /** 'not-configured' | 'failed' when not sent. */
  reason?: string
}

const COPY = {
  calibration: {
    title: 'Extraction confidence scores are no longer reliable',
    summary:
      'In the field groups below, confidence no longer matches how often extractions turn out right, ' +
      'so the 0.85 review threshold may let wrong values through without review.',
    action: 'Check recent corrections in these groups before relying on fields that skipped review.',
    health: '/api/admin/calibration/health',
  },
  accuracy: {
    title: 'Extraction accuracy has dropped',
    summary:
      'In the field groups below, extractions are less accurate than their baseline, ' +
      'or their confidence scores have shifted.',
    action: 'Look at what changed in these document types: a new supplier layout, a model change.',
    health: '/api/admin/accuracy/health',
  },
}

/** The drift breach as a house-style alert. */
export function driftAlert(alert: DriftAlert, appUrl = process.env.NEXT_PUBLIC_APP_URL): Alert {
  const copy = COPY[alert.signal]
  return {
    ...arborAlert({
      severity: 'warning',
      title: copy.title,
      summary: copy.summary,
      facts: alert.groups.map(g => ({ label: g.group, value: g.detail })),
      action: copy.action,
      link: appUrl ? { label: 'Open the health report', url: `${appUrl}${copy.health}` } : undefined,
      ref: alert.runId,
    }),
    at: new Date(alert.breachedAt),
  }
}

export async function dispatchDriftAlert(
  alert: DriftAlert,
  overrides: Partial<SendDeps> = {},
): Promise<AlertDispatchResult> {
  const webhooks = overrides.webhooks ?? {
    ops: process.env.DRIFT_ALERT_WEBHOOK_URL ?? process.env.OPS_SLACK_WEBHOOK_URL,
    enquiries: undefined,
  }
  const { slack } = await sendAlert(driftAlert(alert), 'ops', { ...overrides, webhooks })
  return slack === 'sent' ? { sent: true } : { sent: false, reason: slack }
}
