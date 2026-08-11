// The public supplier form's server-side calls into Nucleos.
//
// This is the one surface a non-Arbor user sees. They have no account, no
// session, and no reason to trust an unexplained error — so every failure here
// has to say something a supplier can act on.
//
// The token is the only credential. It is never logged and never echoed back in
// an error, because these pages are opened from an email that may be forwarded.

import { NucleosUnavailableError, isNucleosConfigured } from './extraction-client'

export interface SupplierFormContext {
  cn_code: string
  sector: string
  description: string | null
  installation_name: string | null
  origin_country: string | null
  importer_name: string | null
  reporting_year: number
  production_routes: { key: string; label: string }[]
  expires_at: string
}

export class SupplierTokenInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupplierTokenInvalidError'
  }
}

function base(): string {
  if (!isNucleosConfigured()) {
    throw new NucleosUnavailableError('NUCLEOS_URL is not configured')
  }
  return process.env.NUCLEOS_URL as string
}

/**
 * Decide what a failure actually was, and throw the matching error.
 *
 * A 404 because the token does not exist and a 404 because the route is not
 * mounted are different problems with different fixes — and only the first is
 * the supplier's. Telling someone their link expired when the real fault is a
 * misconfigured base path sends them to chase a new link that will fail the
 * same way, while the actual bug stays invisible.
 *
 * FastAPI answers an unmatched route with the bare detail "Not Found"; the
 * token check answers with a sentence about the link. That difference is the
 * only signal available, so it is what this reads.
 */
async function throwForStatus(res: Response, what: string): Promise<never> {
  let detail = ''
  try {
    const body = await res.json()
    detail = typeof body?.detail === 'string' ? body.detail : ''
  } catch {
    /* non-JSON body — treat as unavailable below */
  }

  const looksLikeTokenRejection = /link/i.test(detail)
  if ((res.status === 410 || res.status === 403) || (res.status === 404 && looksLikeTokenRejection)) {
    throw new SupplierTokenInvalidError(
      'This link is no longer valid. It may have expired or already been used. ' +
        'Ask the company that sent it for a new one.',
    )
  }

  // The upstream body never travels: it can name internal tables, and an error
  // message ends up in logs and error trackers even when the page shows
  // something generic. The hint below is written here rather than echoed.
  const hint =
    res.status === 404
      ? ' — endpoint not found; check NUCLEOS_URL and that the path includes /api/public'
      : ''
  throw new NucleosUnavailableError(`${what} failed: ${res.status}${hint}`)
}

/** The public endpoint takes no bearer token — the URL token is the credential. */
export async function getSupplierFormContext(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SupplierFormContext> {
  const res = await fetchImpl(`${base()}/api/public/supplier-form/${encodeURIComponent(token)}`, {
    cache: 'no-store',
  })

  if (!res.ok) {
    await throwForStatus(res, 'supplier form context')
  }
  return (await res.json()) as SupplierFormContext
}

export async function submitSupplierForm(
  token: string,
  submission: { see_tco2e_per_t: number; production_route: string; installation_name?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`${base()}/api/public/supplier-form/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(submission),
  })

  if (!res.ok) {
    await throwForStatus(res, 'supplier submission')
  }
}
