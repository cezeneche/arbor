/**
 * @jest-environment node
 */
import { inferSchema } from '../schema-client'
import { BrainUnavailableError } from '../calibration-client'
import { setBrainMetricSink, type BrainCallMetric } from '../metrics'

// Upgrade 2 — the schema client obeys the brain-seam invariant: down ⇒ degrade,
// never block. Every failure mode throws BrainUnavailableError + one metric.

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

describe('inferSchema', () => {
  it('degraded: unconfigured brain rejects without a network call', async () => {
    delete process.env.BRAIN_URL
    await expect(inferSchema([['a']])).rejects.toBeInstanceOf(BrainUnavailableError)
    expect(metrics[0]).toMatchObject({ endpoint: '/infotheory/schema', outcome: 'degraded' })
  })

  it('ok: returns the inferred schema and emits outcome=ok', async () => {
    const payload = { core: ['a'], groups: [['b', 'c']], noise: ['z'], pairs: [] }
    const fetchImpl = jest.fn(async () => okResponse(payload)) as unknown as typeof fetch
    await expect(inferSchema([['a', 'b', 'c']], { fetchImpl })).resolves.toEqual(payload)
    expect(metrics[0].outcome).toBe('ok')
  })

  it('error: a non-2xx response rejects and emits outcome=error', async () => {
    const fetchImpl = jest.fn(
      async () => ({ ok: false, status: 500 }) as unknown as Response,
    ) as unknown as typeof fetch
    await expect(inferSchema([['a']], { fetchImpl })).rejects.toBeInstanceOf(BrainUnavailableError)
    expect(metrics[0].outcome).toBe('error')
  })
})
