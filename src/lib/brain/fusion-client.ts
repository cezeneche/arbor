// TypeScript ↔ brain seam for Bayesian fusion (Upgrade 1).
//
// Sends the per-field self-consistency samples to the brain's /fusion/fields and
// returns the fused posteriors. Fail-soft like the calibration client: any
// misconfiguration, timeout, or non-2xx throws BrainUnavailableError, and the
// caller degrades to single-sample extraction — the brain is never allowed to
// block ingestion.

import { emitBrainMetric, type BrainOutcome } from './metrics'
import { isBrainConfigured, BrainUnavailableError } from './calibration-client'
import type { FusedFieldResult } from '@/lib/extraction/fusion'

export interface FusionInputField {
  field_name: string
  document_class: string
  samples: (string | null)[]
}

export interface FuseFieldsOptions {
  priorAlpha?: number
  priorBeta?: number
  timeoutMs?: number
  /** Injectable fetch, for hermetic tests. */
  fetchImpl?: typeof fetch
}

const FUSION_ENDPOINT = '/fusion/fields'

export async function fuseFields(
  fields: FusionInputField[],
  opts: FuseFieldsOptions = {},
): Promise<FusedFieldResult[]> {
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
      const res = await doFetch(`${process.env.BRAIN_URL}${FUSION_ENDPOINT}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Brain-Token': process.env.BRAIN_INTERNAL_TOKEN as string,
        },
        body: JSON.stringify({
          fields,
          prior_alpha: opts.priorAlpha ?? 1.0,
          prior_beta: opts.priorBeta ?? 1.0,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        outcome = 'error'
        throw new BrainUnavailableError(`brain returned ${res.status}`)
      }
      const body = (await res.json()) as { fields: FusedFieldResult[] }
      outcome = 'ok'
      return body.fields
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    if (err instanceof BrainUnavailableError) throw err
    outcome = (err as Error)?.name === 'AbortError' ? 'timeout' : 'error'
    throw new BrainUnavailableError(`brain fusion failed: ${(err as Error).message}`)
  } finally {
    emitBrainMetric({ endpoint: FUSION_ENDPOINT, outcome, latencyMs: Date.now() - start })
  }
}
