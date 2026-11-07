import { sendAlert, arborAlert, type SendDeps } from '@/lib/alerts/send'
import { renderSlack, type Alert } from '@/lib/alerts/format'

const alert = (severity: Alert['severity']): Alert => ({
  severity,
  source: 'Arbor',
  environment: 'production',
  title: 'Sign-in is failing',
  summary: 'Redis cannot be reached.',
  at: new Date('2026-10-17T14:03:00Z'),
})

function deps(over: Partial<SendDeps> = {}) {
  const posts: { url: string; body: unknown }[] = []
  const emails: { to: string; subject: string }[] = []
  const d: SendDeps = {
    webhooks: { ops: 'https://hooks.slack.test/ops', enquiries: 'https://hooks.slack.test/enq' },
    fetchImpl: (async (url: string, init: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init.body)) })
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch,
    recipients: async () => ['a@arbor.test', 'b@arbor.test'],
    sendEmail: async m => {
      emails.push({ to: m.to, subject: m.subject })
    },
    ...over,
  }
  return { d, posts, emails }
}

describe('sendAlert', () => {
  // Expected: the rendered Slack payload is posted to the stream's webhook.
  // Reason: every message goes through the one format.
  it('posts the house-style payload to the ops channel', async () => {
    const { d, posts } = deps()
    const result = await sendAlert(alert('info'), 'ops', d)
    expect(posts).toEqual([{ url: 'https://hooks.slack.test/ops', body: renderSlack(alert('info')) }])
    expect(result.slack).toBe('sent')
  })

  // Expected: critical and warning are emailed to every platform admin; info and
  // resolved are not. Reason: email is for things someone must act on.
  it.each([
    ['critical', 2],
    ['warning', 2],
    ['info', 0],
    ['resolved', 0],
  ] as const)('%s alerts send %i emails', async (severity, count) => {
    const { d, emails } = deps()
    const result = await sendAlert(alert(severity), 'ops', d)
    expect(emails).toHaveLength(count)
    expect(result.emailed).toBe(count)
    if (count) expect(emails[0].subject).toContain('Sign-in is failing')
  })

  // Expected: enquiries go to their own channel and are never emailed as ops alerts.
  it('routes enquiries to the enquiries channel without email', async () => {
    const { d, posts, emails } = deps()
    await sendAlert(alert('critical'), 'enquiries', d)
    expect(posts[0].url).toBe('https://hooks.slack.test/enq')
    expect(emails).toHaveLength(0)
  })

  // Expected: no webhook → reported as not configured, email still sent.
  // Reason: one channel being unset must not silence the other.
  it('still emails when Slack is not configured', async () => {
    const { d, posts, emails } = deps({ webhooks: { ops: undefined, enquiries: undefined } })
    const result = await sendAlert(alert('critical'), 'ops', d)
    expect(posts).toHaveLength(0)
    expect(result.slack).toBe('not-configured')
    expect(emails).toHaveLength(2)
  })

  // Expected: never throws, whatever fails. Reason: an alert must never break
  // the cron or request that raised it.
  it('never throws when Slack, the admin lookup and email all fail', async () => {
    const { d } = deps({
      fetchImpl: (async () => {
        throw new Error('network down')
      }) as unknown as typeof fetch,
      recipients: async () => {
        throw new Error('db down')
      },
    })
    await expect(sendAlert(alert('critical'), 'ops', d)).resolves.toEqual({ slack: 'failed', emailed: 0 })
  })

  it('reports a Slack rejection as failed', async () => {
    const { d } = deps({
      fetchImpl: (async () => new Response('invalid_blocks', { status: 400 })) as unknown as typeof fetch,
    })
    expect((await sendAlert(alert('info'), 'ops', d)).slack).toBe('failed')
  })

  it('counts only the emails that went', async () => {
    let n = 0
    const { d } = deps({
      sendEmail: async () => {
        if (n++ === 0) throw new Error('bounced')
      },
    })
    expect((await sendAlert(alert('critical'), 'ops', d)).emailed).toBe(1)
  })
})

describe('arborAlert', () => {
  // Expected: source, environment and time filled in. Reason: callers state only
  // what happened.
  it('fills in the source, environment and time', () => {
    const before = Date.now()
    const a = arborAlert({ severity: 'info', title: 't', summary: 's' }, { VERCEL_ENV: 'preview' })
    expect(a.source).toBe('Arbor')
    expect(a.environment).toBe('preview')
    expect(a.at.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('calls an environment outside Vercel development', () => {
    expect(arborAlert({ severity: 'info', title: 't', summary: 's' }, {}).environment).toBe('development')
  })
})
