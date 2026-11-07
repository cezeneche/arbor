// Turns a Sentry webhook into a house-style alert (contract/alerts). Pure.
//
// Sentry catches the errors in Arbor and Nucleos; its alert rules decide which
// are worth telling someone about and post them to /api/alerts/sentry. This is
// where they become the same Slack message and email as every other alert.
// Shapes per Sentry's integration-platform docs: `event_alert` (issue alert
// rules, including cron monitor failures) and `metric_alert` (thresholds).
// Anything else returns null and is acknowledged without a message.
import type { Alert, AlertSeverity } from './format'

type Json = Record<string, unknown>

const obj = (v: unknown): Json | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

const LEVEL: Record<string, AlertSeverity> = { fatal: 'critical', error: 'critical', warning: 'warning' }
const ACTION: Record<string, AlertSeverity> = {
  critical: 'critical',
  warning: 'warning',
  resolved: 'resolved',
}

/** Both SDKs set a `service` tag (arbor / nucleos) so the reader knows which system broke. */
const SERVICE: Record<string, string> = { arbor: 'Arbor', nucleos: 'Nucleos' }

function tag(event: Json, key: string): string | undefined {
  const tags = Array.isArray(event.tags) ? event.tags : []
  const pair = tags.find(t => Array.isArray(t) && t[0] === key) as [string, unknown] | undefined
  return pair ? str(pair[1]) : undefined
}

function when(...candidates: unknown[]): Date {
  for (const c of candidates) {
    const d = typeof c === 'number' ? new Date(c * 1000) : typeof c === 'string' ? new Date(c) : null
    if (d && !Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

function issueAlert(data: Json): Alert | null {
  const event = obj(data.event)
  const title = event && str(event.title)
  if (!event || !title) return null

  const culprit = str(event.culprit)
  const url = str(event.web_url)
  const facts = [
    { label: 'Alert rule', value: str(data.triggered_rule) },
    { label: 'Release', value: str(event.release) },
  ].filter((f): f is { label: string; value: string } => Boolean(f.value))

  return {
    severity: LEVEL[str(event.level) ?? ''] ?? 'info',
    source: SERVICE[tag(event, 'service') ?? ''] ?? 'Sentry',
    environment: str(event.environment) ?? tag(event, 'environment') ?? 'unknown',
    title,
    summary: culprit ? `Raised in ${culprit}.` : 'Sentry recorded a new error.',
    facts,
    link: url ? { label: 'Open in Sentry', url } : undefined,
    ref: str(event.issue_id) ? `sentry ${event.issue_id}` : undefined,
    at: when(event.datetime, event.timestamp),
  }
}

function metricAlert(action: string, data: Json): Alert | null {
  const severity = ACTION[action]
  const metric = obj(data.metric_alert)
  const rule = obj(metric?.alert_rule)
  // The rule's own name, not description_title: that carries Sentry's
  // "Critical:" prefix, which would read "Action needed: Critical: …".
  const title = str(rule?.name) ?? str(metric?.title)
  if (!severity || !title) return null
  const url = str(data.web_url)

  return {
    severity,
    source: 'Sentry',
    environment: str(rule?.environment) ?? 'all environments',
    title,
    summary: str(data.description_text) ?? 'A Sentry metric alert changed state.',
    link: url ? { label: 'Open in Sentry', url } : undefined,
    at: when(metric?.date_detected, metric?.date_started),
  }
}

export function sentryAlert(resource: string | null, body: unknown): Alert | null {
  const payload = obj(body)
  const data = obj(payload?.data)
  if (!payload || !data) return null
  if (resource === 'event_alert') return issueAlert(data)
  if (resource === 'metric_alert') return metricAlert(String(payload.action), data)
  return null
}
