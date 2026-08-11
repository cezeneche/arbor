// The published default emissions value for a commodity code.
//
// These are the Annex VI world-average figures — what applies when no supplier
// figure exists. They are shown so a user can see what doing nothing costs them
// before deciding whether chasing the supplier is worth it.
//
// The figure returned is the value BEFORE the legislated mark-up. Nucleos adds
// the mark-up when the declaration is built, from its own versioned table. Any
// screen showing this number must say so, or it understates the amount that will
// actually be declared.

import { NucleosUnavailableError, isNucleosConfigured } from './extraction-client'

export interface DefaultValueEntry {
  cn8_code: string
  sector: string
  description: string
  /** tCO2e per tonne, before the legislated mark-up. */
  default_see_tco2e_per_t: number
  direct_tco2e_per_t: number
  indirect_tco2e_per_t: number
}

export async function lookupDefaultValues(
  cnPrefix: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DefaultValueEntry[]> {
  if (!isNucleosConfigured()) {
    throw new NucleosUnavailableError('NUCLEOS_URL is not configured')
  }
  const digits = (cnPrefix ?? '').replace(/\D/g, '').slice(0, 8)
  if (digits.length < 2) return []

  const res = await fetchImpl(
    `${process.env.NUCLEOS_URL}/api/public/cbam-cn-lookup?q=${digits}`,
    { cache: 'no-store' },
  )
  if (!res.ok) {
    // Fails closed. An empty list would read as "there is no default for this
    // code", which for an in-scope commodity is never true.
    throw new NucleosUnavailableError(`Default value lookup failed: ${res.status}`)
  }
  const body = (await res.json()) as { results?: DefaultValueEntry[] }
  return body.results ?? []
}
