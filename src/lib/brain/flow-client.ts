// TypeScript ↔ brain seam for graph flow consistency (Upgrade 9).
//
// Sends a supply-flow graph and/or a set of reference claims to the brain's
// /flow/check and returns the conservation + double-counting anomalies. Fail-soft
// like the other brain clients. Runs from an offline anomaly-detection surface,
// never a write or render path.

import { emitBrainMetric, type BrainOutcome } from './metrics'
import { isBrainConfigured, BrainUnavailableError } from './calibration-client'
import type {
  FlowNodeInput,
  FlowEdgeInput,
  FlowClaimInput,
  FlowCheckResponse,
} from './types'

export interface FlowCheckInput {
  nodes?: FlowNodeInput[]
  edges?: FlowEdgeInput[]
  claims?: FlowClaimInput[]
  tolerance?: number
}

export interface CheckFlowOptions {
  timeoutMs?: number
  /** Injectable fetch, for hermetic tests. */
  fetchImpl?: typeof fetch
}

const FLOW_ENDPOINT = '/flow/check'
const EMPTY: FlowCheckResponse = { conservation: [], double_counting: [] }

export async function checkFlow(
  input: FlowCheckInput,
  opts: CheckFlowOptions = {},
): Promise<FlowCheckResponse> {
  const start = Date.now()
  let outcome: BrainOutcome = 'error'
  try {
    if (!isBrainConfigured()) {
      outcome = 'degraded'
      throw new BrainUnavailableError('brain URL or internal token not configured')
    }
    const nothingToCheck =
      (input.nodes?.length ?? 0) === 0 && (input.claims?.length ?? 0) === 0
    if (nothingToCheck) {
      outcome = 'ok'
      return EMPTY
    }

    const doFetch = opts.fetchImpl ?? fetch
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000)
    try {
      const res = await doFetch(`${process.env.BRAIN_URL}${FLOW_ENDPOINT}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Brain-Token': process.env.BRAIN_INTERNAL_TOKEN as string,
        },
        body: JSON.stringify({
          nodes: input.nodes ?? [],
          edges: input.edges ?? [],
          claims: input.claims ?? [],
          tolerance: input.tolerance ?? 0.05,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        outcome = 'error'
        throw new BrainUnavailableError(`brain returned ${res.status}`)
      }
      const body = (await res.json()) as FlowCheckResponse
      outcome = 'ok'
      return body
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    if (err instanceof BrainUnavailableError) throw err
    outcome = (err as Error)?.name === 'AbortError' ? 'timeout' : 'error'
    throw new BrainUnavailableError(`brain flow check failed: ${(err as Error).message}`)
  } finally {
    emitBrainMetric({ endpoint: FLOW_ENDPOINT, outcome, latencyMs: Date.now() - start })
  }
}
