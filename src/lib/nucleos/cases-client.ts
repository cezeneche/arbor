// Reading CBAM cases from Nucleos.
//
// Cases are Nucleos's domain state — Arbor has no model for them and does not
// mirror them. These screens read through the boundary rather than from a local
// copy, so there is nothing to keep in sync and no second version to disagree.
//
// Fails closed, like the extraction client. A CBAM screen that quietly rendered
// an empty case list on a network error would tell an importer they have no
// declarations to make.

import { NucleosUnavailableError, isNucleosConfigured } from './extraction-client'

export interface CbamCaseSummary {
  id: string
  importer_name: string | null
  importer_eori: string | null
  reporting_year: number | null
  reporting_quarter: number | null
  status: string | null
  sector: string | null
  origin_country: string | null
  total_net_mass_kg: number | null
  /** Null whenever no exposure can honestly be shown. */
  estimated_liability_gbp: number | null
  /** Why it is withheld, when it is. */
  estimated_liability_unavailable: {
    reason: string
    sectors: string[]
    detail: string
  } | null
}

export interface CbamCaseListPage {
  items: CbamCaseSummary[]
  total: number
}

const DEFAULT_TIMEOUT_MS = 20_000

export interface CasesRequestOptions {
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

async function nucleosGet<T>(pathAndQuery: string, opts: CasesRequestOptions = {}): Promise<T> {
  if (!isNucleosConfigured()) {
    throw new NucleosUnavailableError(
      'NUCLEOS_URL or NUCLEOS_INTERNAL_TOKEN is not configured',
    )
  }

  const doFetch = opts.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const res = await doFetch(`${process.env.NUCLEOS_URL}${pathAndQuery}`, {
      headers: { authorization: `Bearer ${process.env.NUCLEOS_INTERNAL_TOKEN as string}` },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) {
      throw new NucleosUnavailableError(`Nucleos returned ${res.status} for ${pathAndQuery}`)
    }
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof NucleosUnavailableError) throw err
    if ((err as Error)?.name === 'AbortError') {
      throw new NucleosUnavailableError(`Nucleos timed out for ${pathAndQuery}`)
    }
    throw new NucleosUnavailableError(
      `Nucleos request failed for ${pathAndQuery}: ${(err as Error).message}`,
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function listCbamCases(
  opts: CasesRequestOptions & { limit?: number; offset?: number } = {},
): Promise<CbamCaseListPage> {
  const limit = opts.limit ?? 100
  const offset = opts.offset ?? 0
  const body = await nucleosGet<{ items?: CbamCaseSummary[]; total?: number } | CbamCaseSummary[]>(
    `/api/cbam/cases?limit=${limit}&offset=${offset}`,
    opts,
  )

  // The endpoint has returned both a bare array and a paginated object over its
  // life. Normalising here keeps that history out of the page.
  const items = Array.isArray(body) ? body : (body.items ?? [])
  const total = Array.isArray(body) ? body.length : (body.total ?? items.length)
  return { items, total }
}

export async function getCbamCase(
  caseId: string,
  opts: CasesRequestOptions = {},
): Promise<Record<string, unknown>> {
  return nucleosGet<Record<string, unknown>>(
    `/api/cbam/cases/${encodeURIComponent(caseId)}`,
    opts,
  )
}
