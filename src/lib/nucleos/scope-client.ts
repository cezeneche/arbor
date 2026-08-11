// Pre-import CBAM scope determination.
//
// Answers the question a user actually arrives with: "does this even apply to
// me?" — before any document, any case, any commitment. It is the cheapest
// useful thing the section can do, which is why it opens on it.
//
// Server-side only. The browser posts to an Arbor route, never to Nucleos.

import { NucleosUnavailableError, isNucleosConfigured } from './extraction-client'

export type ScopeStatus = 'in_scope' | 'out_of_scope' | 'requires_review'

export interface ScopeCheckRequest {
  cn_code: string
  origin_country?: string | null
  consignment_value_eur?: number | null
  importer_eori?: string | null
}

export interface ScopeCheckResult {
  status: ScopeStatus
  sector: string | null
  cn_code: string
  origin_country: string | null
  consignment_value_eur: number | null
  importer_eori: string | null
  /** Why the determination came out this way, in order. */
  reasons: string[]
  /** The provisions relied on. An answer without these is an opinion. */
  regulation_refs: string[]
}

export async function checkCbamScope(
  request: ScopeCheckRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ScopeCheckResult> {
  if (!isNucleosConfigured()) {
    throw new NucleosUnavailableError(
      'NUCLEOS_URL or NUCLEOS_INTERNAL_TOKEN is not configured',
    )
  }

  const res = await fetchImpl(`${process.env.NUCLEOS_URL}/api/cbam/scope-check`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.NUCLEOS_INTERNAL_TOKEN as string}`,
    },
    body: JSON.stringify(request),
    cache: 'no-store',
  })

  if (!res.ok) {
    // Never guess a scope answer. "Probably in scope" is not a thing a user can
    // act on, and a wrong "out of scope" means they never file at all.
    throw new NucleosUnavailableError(`Scope check returned ${res.status}`)
  }

  return (await res.json()) as ScopeCheckResult
}
