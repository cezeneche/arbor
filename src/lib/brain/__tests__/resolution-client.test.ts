/**
 * @jest-environment node
 */
import { scoreEntityPairs } from '../resolution-client'
import { BrainUnavailableError } from '../calibration-client'
import { setBrainMetricSink, type BrainCallMetric } from '../metrics'
import type { ResolutionEntityName, ResolutionPair } from '../types'

// Upgrade 5 — the resolution client obeys the same brain-seam invariant as the
// calibration/fusion clients: down ⇒ degrade, never block. Every failure mode
// throws BrainUnavailableError and emits exactly one metric.

const ORIGINAL_ENV = { ...process.env }
let metrics: BrainCallMetric[] = []

const NAMES: ResolutionEntityName[] = [
  { id: 'a', normalised: 'acme steel' },
  { id: 'b', normalised: 'acme steel' },
]
const PAIRS: ResolutionPair[] = [{ a: 'a', b: 'b' }]

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

describe('scoreEntityPairs', () => {
  it('degraded: unconfigured brain rejects without a network call', async () => {
    delete process.env.BRAIN_URL
    await expect(scoreEntityPairs(NAMES, PAIRS)).rejects.toBeInstanceOf(BrainUnavailableError)
    expect(metrics[0]).toMatchObject({ endpoint: '/resolution/score', outcome: 'degraded' })
  })

  it('short-circuits an empty pair set without calling the brain', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch
    await expect(scoreEntityPairs(NAMES, [], { fetchImpl })).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(metrics[0].outcome).toBe('ok')
  })

  it('ok: returns the brain scores and emits outcome=ok', async () => {
    const scores = [{ a: 'a', b: 'b', similarity: 1, decision: 'match' }]
    const fetchImpl = jest.fn(async () => okResponse({ scores })) as unknown as typeof fetch
    await expect(scoreEntityPairs(NAMES, PAIRS, { fetchImpl })).resolves.toEqual(scores)
    expect(metrics[0].outcome).toBe('ok')
  })

  it('error: a non-2xx response rejects and emits outcome=error', async () => {
    const fetchImpl = jest.fn(
      async () => ({ ok: false, status: 500 }) as unknown as Response,
    ) as unknown as typeof fetch
    await expect(scoreEntityPairs(NAMES, PAIRS, { fetchImpl })).rejects.toBeInstanceOf(
      BrainUnavailableError,
    )
    expect(metrics[0].outcome).toBe('error')
  })

  it('timeout: an aborted request emits outcome=timeout', async () => {
    const fetchImpl = jest.fn(async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }) as unknown as typeof fetch
    await expect(scoreEntityPairs(NAMES, PAIRS, { fetchImpl })).rejects.toBeInstanceOf(
      BrainUnavailableError,
    )
    expect(metrics[0].outcome).toBe('timeout')
  })
})
