// Asking Nucleos what a case's goods lines actually declare.
//
// The engine, the contract and the tests for this have existed since the
// integration landed; nothing in Arbor called it. `CalculatedLine`,
// `EmissionsMethod`, `RejectedMethod` and `DecisionAtom` were all in the
// contract and none of them was ever rendered.
//
// Fails closed, for the same reason the extraction client does and more so:
// the calculation endpoint itself refuses to return a partial figure, because a
// declaration short one goods line looks exactly like a complete one and the
// number is what gets filed. A client that degraded to "no emissions shown"
// would put that same indistinguishable state on the screen.

import { NucleosUnavailableError, isNucleosConfigured } from './extraction-client'
import type { CalculationResult, DeclarationPayload } from './contract'

const CALCULATE_ENDPOINT = '/api/internal/calculate'
const DEFAULT_TIMEOUT_MS = 30_000

export interface CalculateOptions {
  timeoutMs?: number
  /** Injectable fetch, for hermetic tests. */
  fetchImpl?: typeof fetch
}

export class NucleosCalculationError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'NucleosCalculationError'
    this.status = status
  }
}

export async function calculateDeclaration(
  payload: DeclarationPayload,
  opts: CalculateOptions = {},
): Promise<CalculationResult> {
  if (!isNucleosConfigured()) {
    throw new NucleosUnavailableError(
      'NUCLEOS_URL or NUCLEOS_INTERNAL_TOKEN is not configured',
    )
  }

  const doFetch = opts.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const res = await doFetch(`${process.env.NUCLEOS_URL}${CALCULATE_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.NUCLEOS_INTERNAL_TOKEN as string}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new NucleosCalculationError(
        `Nucleos calculation returned ${res.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
        res.status,
      )
    }

    const body = (await res.json()) as CalculationResult
    assertUsableResult(body, payload)
    return body
  } catch (err) {
    if (err instanceof NucleosCalculationError) throw err
    if (err instanceof NucleosUnavailableError) throw err
    if ((err as Error)?.name === 'AbortError') {
      throw new NucleosUnavailableError('Nucleos calculation timed out')
    }
    throw new NucleosUnavailableError(
      `Nucleos calculation failed: ${(err as Error).message}`,
    )
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * A 200 that answers a different question is not an answer.
 *
 * The line count is checked as well as the case reference, because the endpoint
 * fails closed on any line it could not calculate — a response with fewer lines
 * than were sent would be a short declaration that renders as a complete one,
 * which is exactly the failure the endpoint's own design exists to prevent.
 */
function assertUsableResult(body: CalculationResult, sent: DeclarationPayload): void {
  if (!body || typeof body !== 'object') {
    throw new NucleosCalculationError('Nucleos returned a non-object body', 200)
  }
  if (body.case_reference !== sent.case_reference) {
    throw new NucleosCalculationError(
      `Nucleos calculated case ${body.case_reference} for a request about ${sent.case_reference}`,
      200,
    )
  }
  if (!body.engine?.engine_version) {
    throw new NucleosCalculationError(
      'Nucleos result carries no engine version — the figure could not be reproduced later',
      200,
    )
  }
  const returned = body.lines?.length ?? 0
  if (returned !== sent.lines.length) {
    throw new NucleosCalculationError(
      `Nucleos returned ${returned} calculated lines for ${sent.lines.length} sent — ` +
        'a total built from part of a declaration reads as a complete one',
      200,
    )
  }
}
