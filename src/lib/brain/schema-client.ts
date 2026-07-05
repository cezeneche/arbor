// TypeScript ↔ brain seam for schema inference (Upgrade 2, schema application).
//
// Sends the corpus as one field-name list per document to the brain's
// /infotheory/schema and returns the inferred core/groups/noise classification.
// Fail-soft like the other brain clients: any misconfiguration, timeout, or
// non-2xx throws BrainUnavailableError, and the caller degrades. This runs from
// an on-demand admin analysis route, never a write or render path.

import { emitBrainMetric, type BrainOutcome } from './metrics'
import { isBrainConfigured, BrainUnavailableError } from './calibration-client'
import type { SchemaInferResponse } from './types'

export interface InferSchemaOptions {
  miThreshold?: number
  coreRate?: number
  noiseRate?: number
  timeoutMs?: number
  /** Injectable fetch, for hermetic tests. */
  fetchImpl?: typeof fetch
}

const SCHEMA_ENDPOINT = '/infotheory/schema'

export async function inferSchema(
  documents: string[][],
  opts: InferSchemaOptions = {},
): Promise<SchemaInferResponse> {
  const start = Date.now()
  let outcome: BrainOutcome = 'error'
  try {
    if (!isBrainConfigured()) {
      outcome = 'degraded'
      throw new BrainUnavailableError('brain URL or internal token not configured')
    }

    const doFetch = opts.fetchImpl ?? fetch
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000)
    try {
      const res = await doFetch(`${process.env.BRAIN_URL}${SCHEMA_ENDPOINT}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Brain-Token': process.env.BRAIN_INTERNAL_TOKEN as string,
        },
        body: JSON.stringify({
          documents,
          mi_threshold: opts.miThreshold ?? 0.05,
          core_rate: opts.coreRate ?? 0.9,
          noise_rate: opts.noiseRate ?? 0.1,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        outcome = 'error'
        throw new BrainUnavailableError(`brain returned ${res.status}`)
      }
      const body = (await res.json()) as SchemaInferResponse
      outcome = 'ok'
      return body
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    if (err instanceof BrainUnavailableError) throw err
    outcome = (err as Error)?.name === 'AbortError' ? 'timeout' : 'error'
    throw new BrainUnavailableError(`brain schema inference failed: ${(err as Error).message}`)
  } finally {
    emitBrainMetric({ endpoint: SCHEMA_ENDPOINT, outcome, latencyMs: Date.now() - start })
  }
}
