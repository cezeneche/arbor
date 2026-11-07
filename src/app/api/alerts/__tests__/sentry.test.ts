/**
 * POST /api/alerts/sentry — Sentry's alert rules post here; the alert leaves in
 * the house style to Slack and email. Sentry signs each delivery with the
 * integration's client secret (Sentry-Hook-Signature, hex HMAC-SHA256) and wants
 * an answer within a second, so the sending happens after the response.
 */
import { createHmac } from 'node:crypto'

const sendAlert = jest.fn(async () => ({ slack: 'sent', emailed: 1 }))
jest.mock('@/lib/alerts/send', () => ({ sendAlert: (...a: unknown[]) => sendAlert(...(a as [])) }))

const deferred: (() => unknown)[] = []
jest.mock('next/server', () => ({
  ...jest.requireActual('next/server'),
  after: (fn: () => unknown) => deferred.push(fn),
}))

import { NextRequest } from 'next/server'
import { POST } from '../sentry/route'

const SECRET = 'client-secret'

const payload = {
  action: 'triggered',
  data: {
    triggered_rule: 'New issue in production',
    event: { title: 'TypeError: boom', level: 'error', web_url: 'https://arbor.sentry.io/issues/1/' },
  },
}

function request(body: string, opts: { resource?: string; signature?: string | null } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  headers['sentry-hook-resource'] = opts.resource ?? 'event_alert'
  const signature =
    opts.signature === undefined ? createHmac('sha256', SECRET).update(body).digest('hex') : opts.signature
  if (signature) headers['sentry-hook-signature'] = signature
  return new NextRequest('http://arbor.test/api/alerts/sentry', { method: 'POST', body, headers })
}

describe('POST /api/alerts/sentry', () => {
  const OLD = process.env
  beforeEach(() => {
    jest.clearAllMocks()
    deferred.length = 0
    process.env = { ...OLD, SENTRY_WEBHOOK_SECRET: SECRET }
  })
  afterAll(() => {
    process.env = OLD
  })

  // Expected: 503 and nothing sent. Reason: without the secret no delivery can
  // be verified, and an unverified one could put any text in front of admins.
  it('fails closed when the secret is not set', async () => {
    delete process.env.SENTRY_WEBHOOK_SECRET
    const res = await POST(request(JSON.stringify(payload)))
    expect(res.status).toBe(503)
    expect(deferred).toHaveLength(0)
  })

  it.each([
    ['missing', null],
    ['wrong', 'a'.repeat(64)],
  ])('rejects a %s signature', async (_label, signature) => {
    const res = await POST(request(JSON.stringify(payload), { signature }))
    expect(res.status).toBe(401)
    expect(deferred).toHaveLength(0)
  })

  // Expected: 200 at once, and the alert sent to the ops channel afterwards.
  it('acknowledges first, then sends the alert to ops', async () => {
    const res = await POST(request(JSON.stringify(payload)))
    expect(res.status).toBe(200)
    expect(sendAlert).not.toHaveBeenCalled()

    await Promise.all(deferred.map(fn => fn()))
    expect(sendAlert).toHaveBeenCalledTimes(1)
    const [alert, channel] = sendAlert.mock.calls[0] as unknown as [{ title: string }, string]
    expect(alert.title).toBe('TypeError: boom')
    expect(channel).toBe('ops')
  })

  // Expected: accepted. Reason: Sentry's documented example signs the parsed
  // body re-serialised with JSON.stringify, which can differ from the raw bytes
  // in whitespace.
  it('accepts a signature over the re-serialised body', async () => {
    const pretty = JSON.stringify(payload, null, 2)
    const signature = createHmac('sha256', SECRET).update(JSON.stringify(payload)).digest('hex')
    const res = await POST(request(pretty, { signature }))
    expect(res.status).toBe(200)
    expect(deferred).toHaveLength(1)
  })

  it('acknowledges a resource it does not alert on, without sending', async () => {
    const res = await POST(
      request(JSON.stringify({ action: 'created', data: {} }), { resource: 'installation' }),
    )
    expect(res.status).toBe(200)
    expect(deferred).toHaveLength(0)
  })

  it('rejects a body that is not JSON', async () => {
    const res = await POST(request('not json'))
    expect(res.status).toBe(400)
  })
})
