import { dispatchDriftAlert, driftAlert } from '../drift-alert-dispatch'
import type { DriftAlert } from '../drift-alert'

// Fail-soft dispatch in the house style (contract/alerts). An alert must never
// break the cron that raised it: no channel configured → no-op; a network or
// HTTP failure → reported, never thrown. The breach itself is always persisted
// and on the health endpoint regardless — the alert is the push, not the record.

const calibration: DriftAlert = {
  signal: 'calibration',
  runId: 'run_1',
  summary: 'Calibration kill signal breached — mass above the ECE ceiling',
  groups: [{ group: 'mass', detail: 'ECE 9.0% over threshold (n=120)' }],
  breachedAt: '2026-07-20T03:00:00.000Z',
}

const noEmail = { recipients: async () => [], sendEmail: jest.fn() }

describe('driftAlert', () => {
  // Expected: a warning that says what the breach means, one fact per group,
  // the run as the reference. Reason: the reader must know what is at stake
  // without knowing what ECE is.
  it('describes a calibration breach in plain terms', () => {
    const a = driftAlert(calibration)
    expect(a.severity).toBe('warning')
    expect(a.title).toBe('Extraction confidence scores are no longer reliable')
    expect(a.summary).toMatch(/0\.85/)
    expect(a.facts).toEqual([{ label: 'mass', value: 'ECE 9.0% over threshold (n=120)' }])
    expect(a.ref).toBe('run_1')
    expect(a.at.toISOString()).toBe('2026-07-20T03:00:00.000Z')
  })

  it('describes an accuracy breach', () => {
    const a = driftAlert({ ...calibration, signal: 'accuracy' })
    expect(a.title).toBe('Extraction accuracy has dropped')
  })
})

describe('dispatchDriftAlert', () => {
  const OLD = { ...process.env }
  afterEach(() => {
    process.env = { ...OLD }
  })

  it('is a no-op on Slack when no webhook is configured (and never calls fetch)', async () => {
    delete process.env.DRIFT_ALERT_WEBHOOK_URL
    delete process.env.OPS_SLACK_WEBHOOK_URL
    const fetchImpl = jest.fn()
    const result = await dispatchDriftAlert(calibration, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ...noEmail,
    })
    expect(result).toEqual({ sent: false, reason: 'not-configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // Expected: DRIFT_ALERT_WEBHOOK_URL wins, else the ops channel. Reason: a team
  // that set a drift channel keeps it; otherwise drift lands with the other alerts.
  it.each([
    [
      {
        DRIFT_ALERT_WEBHOOK_URL: 'https://hooks.test/drift',
        OPS_SLACK_WEBHOOK_URL: 'https://hooks.test/ops',
      },
      'https://hooks.test/drift',
    ],
    [{ OPS_SLACK_WEBHOOK_URL: 'https://hooks.test/ops' }, 'https://hooks.test/ops'],
  ])('posts the formatted alert to the right channel', async (env, expected) => {
    delete process.env.DRIFT_ALERT_WEBHOOK_URL
    Object.assign(process.env, env)
    const fetchImpl = jest.fn(async () => new Response('ok', { status: 200 }))
    const result = await dispatchDriftAlert(calibration, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ...noEmail,
    })
    expect(result).toEqual({ sent: true })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(expected)
    expect(JSON.parse(String(init.body)).text).toBe(
      'Warning: Extraction confidence scores are no longer reliable',
    )
  })

  it('reports a rejection or a network error without throwing', async () => {
    process.env.OPS_SLACK_WEBHOOK_URL = 'https://hooks.test/ops'
    const refused = jest.fn(async () => new Response('no', { status: 500 }))
    expect(
      await dispatchDriftAlert(calibration, { fetchImpl: refused as unknown as typeof fetch, ...noEmail }),
    ).toEqual({
      sent: false,
      reason: 'failed',
    })
    const down = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    expect(
      await dispatchDriftAlert(calibration, { fetchImpl: down as unknown as typeof fetch, ...noEmail }),
    ).toEqual({
      sent: false,
      reason: 'failed',
    })
  })
})
