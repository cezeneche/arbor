// TypeScript ↔ brain seam for calibration (Upgrade 1).
//
// The offline calibration job reads GroundTruthLabel rows, turns them into
// grouped samples here, and posts them to the brain's POST /calibration/fit.
// The grouping is pure and tested; the network call is a thin, fail-soft
// wrapper — per the brain contract, the brain is never allowed to block Arbor,
// so callers treat BrainUnavailableError as "skip calibration this run".

import { classifyFieldType } from './field-types'
import { emitBrainMetric, type BrainOutcome } from './metrics'
import type { CalibrationFitResponse, LabelSample } from './types'

export type CalibrationGroupBy = 'fieldType' | 'fieldName' | 'documentClass'

/** The subset of a GroundTruthLabel row calibration needs. */
export interface GroundTruthRow {
  fieldName: string
  documentClass: string
  confidenceAtExtraction: number
  wasCorrect: boolean
}

function groupKeyFor(row: GroundTruthRow, by: CalibrationGroupBy): string {
  switch (by) {
    case 'fieldName':
      return row.fieldName
    case 'documentClass':
      return row.documentClass
    case 'fieldType':
      // Coarse kill-signal type when known, else the raw field name.
      return classifyFieldType(row.fieldName) ?? row.fieldName
  }
}

/** Pure: turn ground-truth rows into the brain's grouped sample payload. */
export function buildCalibrationSamples(
  rows: GroundTruthRow[],
  by: CalibrationGroupBy = 'fieldType',
): LabelSample[] {
  return rows.map(row => ({
    group: groupKeyFor(row, by),
    score: row.confidenceAtExtraction,
    correct: row.wasCorrect,
  }))
}

export class BrainUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrainUnavailableError'
  }
}

/** Both the URL and the shared secret must be present to call the brain. */
export function isBrainConfigured(): boolean {
  return Boolean(process.env.BRAIN_URL && process.env.BRAIN_INTERNAL_TOKEN)
}

export interface FitCalibrationOptions {
  bins?: number
  minSamples?: number
  timeoutMs?: number
  /** Injectable fetch, for hermetic tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

const CALIBRATION_ENDPOINT = '/calibration/fit'

/**
 * Post samples to the brain and return its calibration report. Fail-soft:
 * throws BrainUnavailableError on any misconfiguration, timeout, or non-2xx —
 * callers degrade (keep the raw scalar score) rather than block ingestion.
 * Emits one {endpoint, outcome, latencyMs} metric per call.
 */
export async function fitCalibration(
  samples: LabelSample[],
  opts: FitCalibrationOptions = {},
): Promise<CalibrationFitResponse> {
  const start = Date.now()
  let outcome: BrainOutcome = 'error'
  try {
    if (!isBrainConfigured()) {
      outcome = 'degraded'
      throw new BrainUnavailableError('brain URL or internal token not configured')
    }

    const doFetch = opts.fetchImpl ?? fetch
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000)
    try {
      const res = await doFetch(`${process.env.BRAIN_URL}${CALIBRATION_ENDPOINT}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Brain-Token': process.env.BRAIN_INTERNAL_TOKEN as string,
        },
        body: JSON.stringify({
          samples,
          bins: opts.bins ?? 10,
          min_samples: opts.minSamples ?? 30,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        outcome = 'error'
        throw new BrainUnavailableError(`brain returned ${res.status}`)
      }
      const body = (await res.json()) as CalibrationFitResponse
      outcome = 'ok'
      return body
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    if (err instanceof BrainUnavailableError) throw err
    // A client-timeout abort surfaces as an AbortError; everything else is a
    // network-level failure. Either way the caller degrades.
    outcome = (err as Error)?.name === 'AbortError' ? 'timeout' : 'error'
    throw new BrainUnavailableError(`brain request failed: ${(err as Error).message}`)
  } finally {
    emitBrainMetric({ endpoint: CALIBRATION_ENDPOINT, outcome, latencyMs: Date.now() - start })
  }
}
