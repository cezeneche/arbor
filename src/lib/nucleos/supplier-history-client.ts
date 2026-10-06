// Reading a goods line's supplier history from Nucleos: the installation's
// earlier figures for the same goods, and whether this line's departs from them.

import { NucleosUnavailableError, isNucleosConfigured } from './extraction-client'
import { nucleosHeaders } from './service-auth'
import type { SupplierHistoryResponse } from './supplier-history-presenter'

export async function getSupplierHistory(
  goodsLineId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SupplierHistoryResponse | null> {
  if (!isNucleosConfigured()) {
    throw new NucleosUnavailableError('NUCLEOS_URL or a Nucleos credential (NUCLEOS_OIDC_AUDIENCE or NUCLEOS_INTERNAL_TOKEN) is not configured')
  }
  const path = `/api/cbam/goods-lines/${encodeURIComponent(goodsLineId)}/supplier-history`
  let res: Response
  try {
    res = await fetchImpl(`${process.env.NUCLEOS_URL}${path}`, { headers: await nucleosHeaders(), cache: 'no-store' })
  } catch (err) {
    throw new NucleosUnavailableError(`Nucleos request failed for ${path}: ${(err as Error).message}`)
  }
  if (res.status === 404) return null
  if (!res.ok) throw new NucleosUnavailableError(`Nucleos returned ${res.status} for ${path}`)
  return (await res.json()) as SupplierHistoryResponse
}
