import { dispatchDriftAlert } from '../drift-alert-dispatch'
import type { DriftAlert } from '../drift-alert'

// Fail-soft webhook dispatch. An alert must never break the cron that raised it:
// no URL configured → no-op; a network or HTTP failure → swallowed and reported,
// never thrown. The breach itself is always persisted and on the health endpoint
// regardless — the webhook is a push convenience, not the source of truth.

const alert: DriftAlert = {
  signal: 'calibration',
  runId: 'run_1',
  summary: 'Calibration kill signal breached — mass above the ECE ceiling',
  groups: [{ group: 'mass', detail: 'ECE 9.0% over threshold (n=120)' }],
  breachedAt: '2026-07-20T03:00:00.000Z',
}

describe('dispatchDriftAlert', () => {
  const OLD_ENV = process.env.DRIFT_ALERT_WEBHOOK_URL
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.DRIFT_ALERT_WEBHOOK_URL
    else process.env.DRIFT_ALERT_WEBHOOK_URL = OLD_ENV
  })

  it('is a no-op when no webhook is configured (and never calls fetch)', async () => {
    delete process.env.DRIFT_ALERT_WEBHOOK_URL
    const fetchImpl = jest.fn()
    const result = await dispatchDriftAlert(alert, { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result).toEqual({ sent: false, reason: 'not-configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('POSTs the alert (with a Slack-friendly text field) to the configured URL', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 })
    const result = await dispatchDriftAlert(alert, {
      webhookUrl: 'https://hooks.example.com/xyz',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ sent: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://hooks.example.com/xyz')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.text).toContain(alert.summary)
    expect(body.runId).toBe('run_1')
    expect(body.signal).toBe('calibration')
  })

  it('reports a non-2xx response without throwing', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 500 })
    const result = await dispatchDriftAlert(alert, {
      webhookUrl: 'https://hooks.example.com/xyz',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ sent: false, reason: 'http_500' })
  })

  it('swallows a network error and reports it (never throws)', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await dispatchDriftAlert(alert, {
      webhookUrl: 'https://hooks.example.com/xyz',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ sent: false, reason: 'error' })
  })
})
