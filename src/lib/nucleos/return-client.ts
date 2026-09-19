// The end of the chain: supplier document → HMRC return.
//
// Both builders have existed on the Nucleos side since the integration landed —
// `hmrc_return_builder`, `eu_xml_builder`, the compliance pack, the report
// package. None of them had an Arbor route, so the product's one sentence
// stopped at "supplier document → reviewed fields".
//
// Two outputs and they are not alternatives to be chosen from a menu. Which one
// exists is decided by the case's jurisdiction: a UK case has no EU registry
// declaration and an EU case has no HMRC charge. `availableReturns` in
// `jurisdiction.ts` is the single place that decides, and the screen offers
// only what it names.
//
// Returns bytes, not JSON, because both outputs are files a human files.

import { NucleosUnavailableError, isNucleosConfigured } from './extraction-client'
import { nucleosHeaders } from './service-auth'

const DEFAULT_TIMEOUT_MS = 60_000

export interface ReturnRequestOptions {
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface ReturnDocument {
  body: ArrayBuffer
  contentType: string
  fileName: string
}

/**
 * A refusal from the builder is not an outage.
 *
 * The 422s it raises are the honest ones — data quality is blocking, no HMRC
 * rate is published, this case is UK-only — and each is something the user can
 * act on. Collapsing them into "Nucleos is unavailable" would tell them to wait
 * for a service that is working perfectly.
 */
export class ReturnNotAvailableError extends Error {
  readonly detail: unknown
  constructor(message: string, detail: unknown) {
    super(message)
    this.name = 'ReturnNotAvailableError'
    this.detail = detail
  }
}

export interface HmrcReturnInput {
  importerVatNumber: string
  importerAddress: Record<string, string>
  /** Must be true. The importer certifies the return is accurate. */
  accuracyDeclaration: boolean
  /** Only when HMRC's published rate has to be entered by hand. */
  cbamRateOverride?: number | null
}

async function postForFile(
  path: string,
  body: unknown,
  fileName: string,
  fallbackContentType: string,
  opts: ReturnRequestOptions,
): Promise<ReturnDocument> {
  if (!isNucleosConfigured()) {
    throw new NucleosUnavailableError(
      'NUCLEOS_URL or NUCLEOS_INTERNAL_TOKEN is not configured',
    )
  }

  const doFetch = opts.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const res = await doFetch(`${process.env.NUCLEOS_URL}${path}`, {
      method: 'POST',
      headers: nucleosHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    })

    if (res.status === 422 || res.status === 404) {
      const detail = await res.json().catch(() => null)
      throw new ReturnNotAvailableError(
        describeRefusal(detail),
        (detail as { detail?: unknown })?.detail ?? detail,
      )
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new NucleosUnavailableError(
        `Nucleos returned ${res.status} for ${path}${text ? `: ${text.slice(0, 300)}` : ''}`,
      )
    }

    return {
      body: await res.arrayBuffer(),
      contentType: res.headers?.get?.('content-type') ?? fallbackContentType,
      fileName,
    }
  } catch (err) {
    if (err instanceof ReturnNotAvailableError) throw err
    if (err instanceof NucleosUnavailableError) throw err
    if ((err as Error)?.name === 'AbortError') {
      throw new NucleosUnavailableError(`Nucleos timed out for ${path}`)
    }
    throw new NucleosUnavailableError(
      `Nucleos request failed for ${path}: ${(err as Error).message}`,
    )
  } finally {
    clearTimeout(timeout)
  }
}

/** The builder's own words, kept. They name the thing the user has to fix. */
function describeRefusal(body: unknown): string {
  const detail = (body as { detail?: unknown })?.detail
  if (typeof detail === 'string') return detail
  const message = (detail as { message?: unknown })?.message
  if (typeof message === 'string') return message
  return 'This return cannot be produced yet.'
}

export async function buildHmrcReturn(
  caseId: string,
  input: HmrcReturnInput,
  opts: ReturnRequestOptions & { format?: 'json' | 'pdf' } = {},
): Promise<ReturnDocument> {
  const format = opts.format ?? 'json'
  return postForFile(
    `/api/cbam/cases/${encodeURIComponent(caseId)}/hmrc-return?format=${format}`,
    {
      importer_vat_number: input.importerVatNumber,
      importer_address: input.importerAddress,
      accuracy_declaration: input.accuracyDeclaration,
      cbam_rate_override: input.cbamRateOverride ?? null,
    },
    `hmrc-cbam-return-${caseId}.${format === 'pdf' ? 'pdf' : 'json'}`,
    format === 'pdf' ? 'application/pdf' : 'application/json',
    opts,
  )
}

export async function buildEuXmlDeclaration(
  caseId: string,
  opts: ReturnRequestOptions = {},
): Promise<ReturnDocument> {
  return postForFile(
    `/api/cbam/cases/${encodeURIComponent(caseId)}/eu-xml`,
    {},
    `cbam-eu-declaration-${caseId}.xml`,
    'application/xml',
    opts,
  )
}
