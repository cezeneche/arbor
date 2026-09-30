// The Nucleos calls behind carbon price relief.
//
// Which schemes the UK recognises, and the currency each prices carbon in, is
// Nucleos's reference data. Arbor used to keep its own copy of the list, which
// had already drifted: it had no Swedish carbon tax. The claim itself is
// calculated and checked by Nucleos; the verifier's statement is an Arbor
// document, and Nucleos records a reference to it.

import { NucleosUnavailableError, isNucleosConfigured } from './extraction-client'
import { nucleosHeaders } from './service-auth'
import { VerificationRejectedError } from './verification-client'

export interface QualifyingScheme {
  name: string
  /** 'confirmed' can be claimed; 'pending' cannot yet. */
  status: string
  /** The currency the scheme's carbon price is quoted in, when Nucleos knows it. */
  currency: string | null
}

export interface QualifyingSchemes {
  claimable: boolean
  schemes: QualifyingScheme[]
  warning: string | null
}

/** A claim as Nucleos stores it. Figures arrive as numbers or strings. */
export interface ReliefClaim {
  id: string
  created_at?: string | null
  qualifying_scheme_name?: string | null
  carbon_price_local_currency?: number | string | null
  local_currency_code?: string | null
  verified_emissions_tco2e?: number | string | null
  exchange_rate_to_gbp?: number | string | null
  exchange_rate_date?: string | null
  cpr_raw_gbp?: number | string | null
  cpr_amount_gbp?: number | string | null
  cpr_capped?: boolean | null
  verifier_name?: string | null
  verification_document_hash?: string | null
}

function base(): string {
  if (!isNucleosConfigured()) {
    throw new NucleosUnavailableError('NUCLEOS_URL or NUCLEOS_INTERNAL_TOKEN is not configured')
  }
  return process.env.NUCLEOS_URL as string
}

async function get<T>(path: string, fetchImpl: typeof fetch): Promise<T> {
  let res: Response
  try {
    res = await fetchImpl(`${base()}${path}`, { headers: nucleosHeaders(), cache: 'no-store' })
  } catch (err) {
    if (err instanceof NucleosUnavailableError) throw err
    throw new NucleosUnavailableError(`Nucleos request failed for ${path}: ${(err as Error).message}`)
  }
  if (!res.ok) throw new NucleosUnavailableError(`Nucleos returned ${res.status} for ${path}`)
  return (await res.json()) as T
}

export async function listQualifyingSchemes(
  originCountry: string,
  fetchImpl: typeof fetch = fetch,
): Promise<QualifyingSchemes> {
  const query = new URLSearchParams({ country: originCountry.trim().toUpperCase() })
  const body = await get<{
    cpr_claimable?: boolean
    schemes?: { scheme_name?: unknown; recognition_status?: unknown; currency_code?: unknown }[]
    warning?: unknown
  }>(`/api/cbam/cpr/qualifying-schemes?${query.toString()}`, fetchImpl)
  return {
    claimable: body.cpr_claimable === true,
    warning: typeof body.warning === 'string' ? body.warning : null,
    schemes: (body.schemes ?? [])
      .filter(s => typeof s.scheme_name === 'string')
      .map(s => ({
        name: s.scheme_name as string,
        status: typeof s.recognition_status === 'string' ? s.recognition_status : 'pending',
        currency: typeof s.currency_code === 'string' ? s.currency_code : null,
      })),
  }
}

/** Every claim on a goods line, newest first. */
export async function listReliefClaims(goodsLineId: string, fetchImpl: typeof fetch = fetch): Promise<ReliefClaim[]> {
  const body = await get<{ claims?: ReliefClaim[] }>(
    `/api/cbam/cpr/claims/${encodeURIComponent(goodsLineId)}`,
    fetchImpl,
  )
  return Array.isArray(body.claims) ? body.claims : []
}

export interface HmrcExchangeRate {
  rate: string
  /** The first of the month the rate applies to. */
  effectiveFrom: string
  source: string
  /** The version of Nucleos's reference table the rate came from. */
  tableVersion: string
}

/**
 * HMRC's rate for a currency in the calendar month of a date, or null when
 * Nucleos does not hold that month. Never the nearest month it does hold:
 * HMRC publishes one rate a month, and last month's is a different figure.
 */
export async function getHmrcExchangeRate(
  currency: string,
  date: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HmrcExchangeRate | null> {
  const query = new URLSearchParams({ currency: currency.trim().toUpperCase(), date })
  const path = `/api/cbam/cpr/exchange-rate?${query.toString()}`
  let res: Response
  try {
    res = await fetchImpl(`${base()}${path}`, { headers: nucleosHeaders(), cache: 'no-store' })
  } catch (err) {
    if (err instanceof NucleosUnavailableError) throw err
    throw new NucleosUnavailableError(`Nucleos request failed for ${path}: ${(err as Error).message}`)
  }
  if (res.status === 404) return null
  if (!res.ok) throw new NucleosUnavailableError(`Nucleos returned ${res.status} for ${path}`)
  const body = (await res.json()) as { rate: string; effective_from: string; source: string; table_version: string }
  return { rate: body.rate, effectiveFrom: body.effective_from, source: body.source, tableVersion: body.table_version }
}

/** Attaches the verifier's statement to the line's claims that have none. */
export async function recordReliefStatement(
  goodsLineId: string,
  statement: { documentRef: string; sha256: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const path = `/api/cbam/cpr/upload-verification/${encodeURIComponent(goodsLineId)}`
  const res = await fetchImpl(`${base()}${path}`, {
    method: 'POST',
    headers: nucleosHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ document_ref: statement.documentRef, document_sha256: statement.sha256 }),
    cache: 'no-store',
  })
  if (res.ok) return
  if (res.status === 404) {
    throw new VerificationRejectedError('There is no relief claim on these goods waiting for a statement.')
  }
  throw new NucleosUnavailableError(`Nucleos returned ${res.status} for ${path}`)
}
