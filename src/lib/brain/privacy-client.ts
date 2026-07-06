// TypeScript ↔ brain seam for differentially-private benchmarks (Upgrade 10).
//
// Sends per-group aggregation values (already reduced to one value per canonical
// entity) to the brain's /privacy/benchmark and returns ε-DP releases. Fail-soft
// like the other brain clients. Runs from an on-demand admin/product route, never
// a write or render path.

import { emitBrainMetric, type BrainOutcome } from './metrics'
import { isBrainConfigured, BrainUnavailableError } from './calibration-client'
import type { DPGroupInput, DPRelease } from './types'

export interface ReleaseDpOptions {
  epsilon?: number
  minN?: number
  timeoutMs?: number
  /** Injectable fetch, for hermetic tests. */
  fetchImpl?: typeof fetch
}

const DP_ENDPOINT = '/privacy/benchmark'

export async function releaseDpBenchmarks(
  groups: DPGroupInput[],
  opts: ReleaseDpOptions = {},
): Promise<DPRelease[]> {
  const start = Date.now()
  let outcome: BrainOutcome = 'error'
  try {
    if (!isBrainConfigured()) {
      outcome = 'degraded'
      throw new BrainUnavailableError('brain URL or internal token not configured')
    }
    if (groups.length === 0) {
      outcome = 'ok'
      return []
    }

    const doFetch = opts.fetchImpl ?? fetch
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000)
    try {
      const res = await doFetch(`${process.env.BRAIN_URL}${DP_ENDPOINT}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Brain-Token': process.env.BRAIN_INTERNAL_TOKEN as string,
        },
        body: JSON.stringify({
          groups,
          epsilon: opts.epsilon ?? 1.0,
          min_n: opts.minN ?? 10,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        outcome = 'error'
        throw new BrainUnavailableError(`brain returned ${res.status}`)
      }
      const body = (await res.json()) as { releases: DPRelease[] }
      outcome = 'ok'
      return body.releases
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    if (err instanceof BrainUnavailableError) throw err
    outcome = (err as Error)?.name === 'AbortError' ? 'timeout' : 'error'
    throw new BrainUnavailableError(`brain dp benchmark failed: ${(err as Error).message}`)
  } finally {
    emitBrainMetric({ endpoint: DP_ENDPOINT, outcome, latencyMs: Date.now() - start })
  }
}
