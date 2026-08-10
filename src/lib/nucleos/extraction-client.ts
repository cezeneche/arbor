// TypeScript ↔ Nucleos seam for CBAM extraction.
//
// Modelled on src/lib/brain/fusion-client.ts, with one deliberate difference:
// this client FAILS CLOSED.
//
// The brain is an enhancement — when it is unavailable, extraction degrades to
// single-sample and the record is still correct, just less well calibrated.
// Nucleos is not an enhancement. It is the only thing that turns a CBAM
// document into CBAM structure. If it is unavailable and we degrade, the
// document lands in Review looking like a clean read of a document that had no
// CBAM data in it, and the reviewer confirms an empty extraction. That is a
// silent under-declaration, so a Nucleos failure has to surface as a failure.

import type {
  CbamExtractionRequest,
  CbamExtractionResult,
} from './contract'

export class NucleosUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NucleosUnavailableError'
  }
}

export class NucleosExtractionError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'NucleosExtractionError'
    this.status = status
  }
}

export function isNucleosConfigured(): boolean {
  return Boolean(process.env.NUCLEOS_URL && process.env.NUCLEOS_INTERNAL_TOKEN)
}

const EXTRACT_ENDPOINT = '/api/internal/cbam/extract'
const DEFAULT_TIMEOUT_MS = 60_000

export interface ExtractCbamOptions {
  timeoutMs?: number
  /** Injectable fetch, for hermetic tests. */
  fetchImpl?: typeof fetch
}

export async function extractCbamFields(
  request: CbamExtractionRequest,
  opts: ExtractCbamOptions = {},
): Promise<CbamExtractionResult> {
  if (!isNucleosConfigured()) {
    throw new NucleosUnavailableError(
      'NUCLEOS_URL or NUCLEOS_INTERNAL_TOKEN is not configured',
    )
  }

  const doFetch = opts.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const res = await doFetch(`${process.env.NUCLEOS_URL}${EXTRACT_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.NUCLEOS_INTERNAL_TOKEN as string}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new NucleosExtractionError(
        `Nucleos extraction returned ${res.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
        res.status,
      )
    }

    const body = (await res.json()) as CbamExtractionResult
    assertUsableResult(body, request.document_id)
    return body
  } catch (err) {
    if (err instanceof NucleosExtractionError) throw err
    if (err instanceof NucleosUnavailableError) throw err
    if ((err as Error)?.name === 'AbortError') {
      throw new NucleosUnavailableError('Nucleos extraction timed out')
    }
    throw new NucleosUnavailableError(
      `Nucleos extraction failed: ${(err as Error).message}`,
    )
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * A 200 carrying the wrong document, or no engine stamp, is not a usable result.
 *
 * Checked rather than trusted because the failure it prevents is invisible: a
 * mismatched document_id would attach one document's fields to another's review
 * screen, and both would look entirely normal.
 */
function assertUsableResult(body: CbamExtractionResult, expectedDocumentId: string): void {
  if (!body || typeof body !== 'object') {
    throw new NucleosExtractionError('Nucleos returned a non-object body', 200)
  }
  if (body.document_id !== expectedDocumentId) {
    throw new NucleosExtractionError(
      `Nucleos returned document_id ${body.document_id} for a request about ${expectedDocumentId}`,
      200,
    )
  }
  if (!body.engine?.engine_version) {
    throw new NucleosExtractionError(
      'Nucleos result carries no engine version — the figure could not be reproduced later',
      200,
    )
  }
}
