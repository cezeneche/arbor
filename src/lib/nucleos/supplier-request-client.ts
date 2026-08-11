// Asking a supplier for the emissions intensity a goods line is missing.
//
// Two ways to fill the gap, and they are not equivalent:
//
//   ASK THE SUPPLIER — a tokenised form they fill in without an account. The
//   answer is a real measurement of their production, which is what the
//   regulation prefers and what removes the default-value mark-up.
//
//   APPLY THE DEFAULT — the published Annex VI value, plus the legislated
//   mark-up. Always available, always higher, and deliberately so: the mark-up
//   exists to make collecting real data cheaper than not collecting it.
//
// Both are offered because a supplier who will not answer is a real situation,
// and a declaration still has to be filed. What must not happen is the default
// being applied silently, as though it were the same answer.

import { NucleosUnavailableError, isNucleosConfigured } from './extraction-client'

/**
 * The request will never succeed as sent — a goods line the service rejects, or
 * a token without the scope to create one.
 *
 * Separate from NucleosUnavailableError because the two need opposite responses.
 * "Try again shortly" is the right thing to say about an outage and exactly the
 * wrong thing to say about a permanent rejection: it sends someone round a loop
 * that never closes, and hides a wiring fault behind a transient-sounding
 * message. That is precisely how the supplier-form path bug survived as long as
 * it did.
 */
export class SupplierRequestRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupplierRequestRejectedError'
  }
}

export interface SupplierTokenResult {
  token: string
  /** The URL to send the supplier. Built by Nucleos from WEB_BASE_URL. */
  form_url: string
  expires_at: string
}

function base(): string {
  if (!isNucleosConfigured()) {
    throw new NucleosUnavailableError('NUCLEOS_URL or NUCLEOS_INTERNAL_TOKEN is not configured')
  }
  return process.env.NUCLEOS_URL as string
}

export async function createSupplierToken(
  goodsLineId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SupplierTokenResult> {
  const res = await fetchImpl(
    `${base()}/api/cbam/goods-lines/${encodeURIComponent(goodsLineId)}/supplier-token`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.NUCLEOS_INTERNAL_TOKEN as string}`,
      },
      cache: 'no-store',
    },
  )

  // The route is declared 201, so success is the whole 2xx range rather than 200.
  if (!res.ok) {
    if (res.status === 422 || res.status === 400) {
      throw new SupplierRequestRejectedError(
        'This goods line cannot be used for a supplier request. It may have been ' +
          'removed, or belong to a case that is no longer open.',
      )
    }
    if (res.status === 403) {
      // Naming the scope because that is the fix. A generic "not permitted"
      // would leave someone reading application logs for a configuration error.
      throw new SupplierRequestRejectedError(
        'The Nucleos token is not permitted to create supplier requests — it needs ' +
          'the cbam:write scope.',
      )
    }
    // 401 included: the token was not accepted at all, which is ours to fix and
    // is not a statement about the goods line.
    throw new NucleosUnavailableError(`Supplier token request failed: ${res.status}`)
  }
  return (await res.json()) as SupplierTokenResult
}
