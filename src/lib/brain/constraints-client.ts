// TypeScript ↔ brain seam for algebraic constraints + MaxEnt completion.
//
// Sends a batch of records (field values + sector) to the brain's
// /constraints/check and returns per-record violations and completions. Fail-soft
// like the other brain clients: any misconfiguration, timeout, or non-2xx throws
// BrainUnavailableError and the caller degrades. Runs from an on-demand analysis
// route, off any write or render path.

import { emitBrainMetric, type BrainOutcome } from './metrics'
import { isBrainConfigured, BrainUnavailableError } from './calibration-client'
import type { ConstraintRecordInput, ConstraintRecordResult } from './types'

export interface CheckConstraintsOptions {
  timeoutMs?: number
  /** Injectable fetch, for hermetic tests. */
  fetchImpl?: typeof fetch
}

const CONSTRAINTS_ENDPOINT = '/constraints/check'

export async function checkConstraints(
  records: ConstraintRecordInput[],
  opts: CheckConstraintsOptions = {},
): Promise<ConstraintRecordResult[]> {
  const start = Date.now()
  let outcome: BrainOutcome = 'error'
  try {
    if (!isBrainConfigured()) {
      outcome = 'degraded'
      throw new BrainUnavailableError('brain URL or internal token not configured')
    }
    if (records.length === 0) {
      outcome = 'ok'
      return []
    }

    const doFetch = opts.fetchImpl ?? fetch
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000)
    try {
      const res = await doFetch(`${process.env.BRAIN_URL}${CONSTRAINTS_ENDPOINT}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Brain-Token': process.env.BRAIN_INTERNAL_TOKEN as string,
        },
        body: JSON.stringify({ records }),
        signal: controller.signal,
      })
      if (!res.ok) {
        outcome = 'error'
        throw new BrainUnavailableError(`brain returned ${res.status}`)
      }
      const body = (await res.json()) as { results: ConstraintRecordResult[] }
      outcome = 'ok'
      return body.results
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    if (err instanceof BrainUnavailableError) throw err
    outcome = (err as Error)?.name === 'AbortError' ? 'timeout' : 'error'
    throw new BrainUnavailableError(`brain constraints check failed: ${(err as Error).message}`)
  } finally {
    emitBrainMetric({ endpoint: CONSTRAINTS_ENDPOINT, outcome, latencyMs: Date.now() - start })
  }
}
