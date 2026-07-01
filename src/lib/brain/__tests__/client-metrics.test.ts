/**
 * @jest-environment node
 */
import {
  fitCalibration,
  BrainUnavailableError,
} from '../calibration-client'
import { setBrainMetricSink, type BrainCallMetric } from '../metrics'

// Locks in the brain seam's core invariant: down ⇒ degrade, never block. Every
// failure mode throws BrainUnavailableError (which callers treat as "skip
// calibration this run") and emits exactly one {endpoint, outcome, latencyMs}
// metric with the right outcome.

const ORIGINAL_ENV = { ...process.env }
let metrics: BrainCallMetric[] = []

beforeEach(() => {
  metrics = []
  setBrainMetricSink(m => metrics.push(m))
  process.env.BRAIN_URL = 'http://brain.internal'
  process.env.BRAIN_INTERNAL_TOKEN = 'secret'
})

afterEach(() => {
  setBrainMetricSink(() => {})
  process.env.BRAIN_URL = ORIGINAL_ENV.BRAIN_URL
  process.env.BRAIN_INTERNAL_TOKEN = ORIGINAL_ENV.BRAIN_INTERNAL_TOKEN
})

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

describe('fitCalibration outcome classification + metrics', () => {
  it('degraded: unconfigured brain rejects without a network call', async () => {
    delete process.env.BRAIN_URL
    await expect(fitCalibration([])).rejects.toBeInstanceOf(BrainUnavailableError)
    expect(metrics).toHaveLength(1)
    expect(metrics[0]).toMatchObject({ endpoint: '/calibration/fit', outcome: 'degraded' })
    expect(metrics[0].latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('ok: a 2xx response resolves and emits outcome=ok', async () => {
    const payload = { groups: [], fitted_at: '2026-07-01T00:00:00Z' }
    const fetchImpl = jest.fn(async () => okResponse(payload)) as unknown as typeof fetch
    await expect(fitCalibration([], { fetchImpl })).resolves.toEqual(payload)
    expect(metrics[0].outcome).toBe('ok')
  })

  it('error: a non-2xx response rejects and emits outcome=error', async () => {
    const fetchImpl = jest.fn(
      async () => ({ ok: false, status: 500 }) as unknown as Response,
    ) as unknown as typeof fetch
    await expect(fitCalibration([], { fetchImpl })).rejects.toBeInstanceOf(BrainUnavailableError)
    expect(metrics[0].outcome).toBe('error')
  })

  it('error: a network failure rejects and emits outcome=error', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    await expect(fitCalibration([], { fetchImpl })).rejects.toBeInstanceOf(BrainUnavailableError)
    expect(metrics[0].outcome).toBe('error')
  })

  it('timeout: an aborted request emits outcome=timeout', async () => {
    const fetchImpl = jest.fn(async () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }) as unknown as typeof fetch
    await expect(fitCalibration([], { fetchImpl })).rejects.toBeInstanceOf(BrainUnavailableError)
    expect(metrics[0].outcome).toBe('timeout')
  })
})

describe('brain-down integration (real unreachable host)', () => {
  it('a dead brain degrades fast instead of hanging', async () => {
    // 127.0.0.1:1 refuses connections immediately — the real fail-soft path.
    process.env.BRAIN_URL = 'http://127.0.0.1:1'
    const started = Date.now()
    await expect(
      fitCalibration([{ group: 'mass', score: 0.5, correct: true }], { timeoutMs: 2000 }),
    ).rejects.toBeInstanceOf(BrainUnavailableError)
    // Degraded, not blocked: well under the timeout, and a metric was emitted.
    expect(Date.now() - started).toBeLessThan(2000)
    expect(metrics).toHaveLength(1)
    expect(['error', 'timeout']).toContain(metrics[0].outcome)
  }, 10000)
})
