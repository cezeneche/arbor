import { sentryAlert } from '@/lib/alerts/sentry'

// Sentry's alerts arrive by webhook and leave in the house style, so an error in
// Arbor or Nucleos reads like every other alert. Payload shapes from Sentry's
// integration-platform docs (issue alerts and metric alerts).

const issueAlert = {
  action: 'triggered',
  data: {
    triggered_rule: 'New issue in production',
    event: {
      title: "TypeError: Cannot read properties of undefined (reading 'id')",
      culprit: 'POST /api/documents/[id]',
      level: 'error',
      web_url: 'https://arbor.sentry.io/issues/1117540176/events/abc/',
      issue_id: '1117540176',
      release: 'arbor@9b8887b',
      datetime: '2026-10-17T14:03:27.000Z',
      tags: [
        ['environment', 'production'],
        ['service', 'arbor'],
      ],
    },
  },
}

describe('sentryAlert: issue alerts', () => {
  // Expected: the error as the title, where it was raised as the summary, the
  // rule and release as facts, a button to the Sentry issue.
  it('turns an issue alert into a critical alert', () => {
    expect(sentryAlert('event_alert', issueAlert)).toEqual({
      severity: 'critical',
      source: 'Arbor',
      environment: 'production',
      title: "TypeError: Cannot read properties of undefined (reading 'id')",
      summary: 'Raised in POST /api/documents/[id].',
      facts: [
        { label: 'Alert rule', value: 'New issue in production' },
        { label: 'Release', value: 'arbor@9b8887b' },
      ],
      link: { label: 'Open in Sentry', url: 'https://arbor.sentry.io/issues/1117540176/events/abc/' },
      ref: 'sentry 1117540176',
      at: new Date('2026-10-17T14:03:27.000Z'),
    })
  })

  // Expected: the service tag names the system. Reason: both Arbor and Nucleos
  // report to Sentry and the reader must know which one broke.
  it('names Nucleos from its service tag', () => {
    const payload = structuredClone(issueAlert)
    payload.data.event.tags = [['service', 'nucleos']]
    expect(sentryAlert('event_alert', payload)?.source).toBe('Nucleos')
  })

  it.each([
    ['fatal', 'critical'],
    ['error', 'critical'],
    ['warning', 'warning'],
    ['info', 'info'],
  ])('maps level %s to %s', (level, severity) => {
    const payload = structuredClone(issueAlert)
    payload.data.event.level = level
    expect(sentryAlert('event_alert', payload)?.severity).toBe(severity)
  })

  // Expected: missing optional fields are left out, not shown as "undefined".
  it('copes with a sparse event', () => {
    const alert = sentryAlert('event_alert', { action: 'triggered', data: { event: { title: 'Boom' } } })
    expect(alert).toMatchObject({ title: 'Boom', source: 'Sentry', environment: 'unknown', facts: [] })
    expect(alert?.summary).toBe('Sentry recorded a new error.')
    expect(alert?.link).toBeUndefined()
  })
})

describe('sentryAlert: metric alerts', () => {
  const metric = (action: string) => ({
    action,
    data: {
      description_title: `${action === 'resolved' ? 'Resolved' : 'Critical'}: Too many errors`,
      description_text: '25 errors in the last 5 minutes',
      web_url: 'https://arbor.sentry.io/alerts/rules/details/1/',
      metric_alert: {
        alert_rule: { name: 'Too many errors' },
        date_started: '2026-10-17T14:00:00.000Z',
      },
    },
  })

  // Expected: the rule name as the title, without Sentry's own "Critical:" prefix,
  // which would read "Action needed: Critical: …".
  it.each([
    ['critical', 'critical'],
    ['warning', 'warning'],
    ['resolved', 'resolved'],
  ])('maps action %s to %s with the rule name as title', (action, severity) => {
    expect(sentryAlert('metric_alert', metric(action))).toMatchObject({
      severity,
      title: 'Too many errors',
      summary: '25 errors in the last 5 minutes',
      link: { label: 'Open in Sentry', url: 'https://arbor.sentry.io/alerts/rules/details/1/' },
    })
  })
})

describe('sentryAlert: everything else', () => {
  // Expected: null, so the route acknowledges and sends nothing.
  it.each([
    ['installation', { action: 'created' }],
    ['issue', { action: 'assigned' }],
    ['event_alert', { action: 'triggered' }],
    [null, issueAlert],
    ['event_alert', 'not an object'],
  ])('ignores %s', (resource, body) => {
    expect(sentryAlert(resource, body)).toBeNull()
  })
})
