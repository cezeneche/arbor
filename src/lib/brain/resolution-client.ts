// TypeScript ↔ brain seam for entity-resolution scoring.
//
// The blocking layer (src/lib/entity-resolution/blocking.ts) reduces the corpus
// to candidate pairs; this posts the normalised names + pairs to the brain's
// /resolution/score and returns the scored, banded pairs. Fail-soft like the
// other brain clients: any misconfiguration, timeout, or non-2xx throws
// BrainUnavailableError, and the caller degrades (skip scoring this run) rather
// than block — the brain is never in a write path.

import { emitBrainMetric, type BrainOutcome } from './metrics'
import { isBrainConfigured, BrainUnavailableError } from './calibration-client'
import type {
  ResolutionEntityName,
  ResolutionPair,
  ResolutionScoreResponse,
  ScoredPair,
} from './types'

export interface ScorePairsOptions {
  ngram?: number
  thresholdMatch?: number
  thresholdReview?: number
  timeoutMs?: number
  /** Injectable fetch, for hermetic tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

const RESOLUTION_ENDPOINT = '/resolution/score'

export async function scoreEntityPairs(
  names: ResolutionEntityName[],
  pairs: ResolutionPair[],
  opts: ScorePairsOptions = {},
): Promise<ScoredPair[]> {
  const start = Date.now()
  let outcome: BrainOutcome = 'error'
  try {
    if (!isBrainConfigured()) {
      outcome = 'degraded'
      throw new BrainUnavailableError('brain URL or internal token not configured')
    }
    // Nothing to score — skip the round trip.
    if (pairs.length === 0) {
      outcome = 'ok'
      return []
    }

    const doFetch = opts.fetchImpl ?? fetch
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000)
    try {
      const res = await doFetch(`${process.env.BRAIN_URL}${RESOLUTION_ENDPOINT}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Brain-Token': process.env.BRAIN_INTERNAL_TOKEN as string,
        },
        body: JSON.stringify({
          names,
          pairs,
          ngram: opts.ngram ?? 3,
          threshold_match: opts.thresholdMatch ?? 0.85,
          threshold_review: opts.thresholdReview ?? 0.65,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        outcome = 'error'
        throw new BrainUnavailableError(`brain returned ${res.status}`)
      }
      const body = (await res.json()) as ResolutionScoreResponse
      outcome = 'ok'
      return body.scores
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    if (err instanceof BrainUnavailableError) throw err
    outcome = (err as Error)?.name === 'AbortError' ? 'timeout' : 'error'
    throw new BrainUnavailableError(`brain resolution failed: ${(err as Error).message}`)
  } finally {
    emitBrainMetric({ endpoint: RESOLUTION_ENDPOINT, outcome, latencyMs: Date.now() - start })
  }
}
