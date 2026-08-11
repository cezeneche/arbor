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

  if (!res.ok) {
    // Fails closed. A half-created request would leave the user believing a
    // supplier had been asked when nobody had.
    throw new NucleosUnavailableError(`Supplier token request failed: ${res.status}`)
  }
  return (await res.json()) as SupplierTokenResult
}
