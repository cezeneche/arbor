// The Nucleos calls behind a verifier's statement.
//
// The statement is an Arbor document: Arbor stores the file and computes its
// SHA-256, and Nucleos records a reference to it — Nucleos holds no documents.
// Nucleos owns the status the returns read (not_required → pending →
// submitted → verified | rejected), so every step goes through it.

import { NucleosUnavailableError, isNucleosConfigured } from './extraction-client'
import { nucleosHeaders } from './service-auth'

/** Nucleos refused the step because the line is not in a state that allows it. */
export class VerificationRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VerificationRejectedError'
  }
}

export interface StatementReference {
  verifierName: string
  verifierAccreditation: string
  /** Arbor's reference for the stored statement. */
  documentRef: string
  sha256: string
}

function base(): string {
  if (!isNucleosConfigured()) {
    throw new NucleosUnavailableError(
      'NUCLEOS_URL or a Nucleos credential (NUCLEOS_OIDC_AUDIENCE or NUCLEOS_INTERNAL_TOKEN) is not configured',
    )
  }
  return process.env.NUCLEOS_URL as string
}

async function post(path: string, body: unknown, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(`${base()}${path}`, {
    method: 'POST',
    headers: await nucleosHeaders({ 'content-type': 'application/json' }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  })
  if (res.ok) return
  if (res.status === 409 || res.status === 404) {
    const detail = await res.json().then(
      b => (b as { detail?: unknown }).detail,
      () => null,
    )
    throw new VerificationRejectedError(
      typeof detail === 'string' ? detail : 'This goods line cannot take that step now.',
    )
  }
  throw new NucleosUnavailableError(`Nucleos returned ${res.status} for ${path}`)
}

const line = (goodsLineId: string) => `/api/cbam/goods-lines/${encodeURIComponent(goodsLineId)}`

/** not_required or rejected → pending: a statement is on its way. */
export function requestVerification(goodsLineId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  return post(`${line(goodsLineId)}/request-verification`, undefined, fetchImpl)
}

/** pending → submitted: the statement, as a reference and hash. */
export function recordVerificationStatement(
  goodsLineId: string,
  statement: StatementReference,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  return post(
    `${line(goodsLineId)}/upload-verification`,
    {
      verifier_name: statement.verifierName,
      verifier_accreditation: statement.verifierAccreditation,
      document_ref: statement.documentRef,
      document_sha256: statement.sha256,
    },
    fetchImpl,
  )
}

/** submitted → verified: the figure can go on the return as actual, verified. */
export function acceptVerification(goodsLineId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  return post(`${line(goodsLineId)}/verify`, undefined, fetchImpl)
}

/** submitted → rejected, with the reason the importer will read. */
export function rejectVerification(
  goodsLineId: string,
  reason: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  return post(`${line(goodsLineId)}/reject-verification`, { reason }, fetchImpl)
}
