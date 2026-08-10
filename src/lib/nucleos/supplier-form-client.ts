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

/** The public endpoint takes no bearer token — the URL token is the credential. */
export async function getSupplierFormContext(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SupplierFormContext> {
  const res = await fetchImpl(`${base()}/api/supplier-form/${encodeURIComponent(token)}`, {
    cache: 'no-store',
  })

  if (res.status === 404 || res.status === 410 || res.status === 403) {
    throw new SupplierTokenInvalidError(
      'This link is no longer valid. It may have expired or already been used. ' +
        'Ask the company that sent it for a new one.',
    )
  }
  if (!res.ok) {
    throw new NucleosUnavailableError(`Supplier form context failed: ${res.status}`)
  }
  return (await res.json()) as SupplierFormContext
}

export async function submitSupplierForm(
  token: string,
  submission: { see_tco2e_per_t: number; production_route: string; installation_name?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`${base()}/api/supplier-form/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(submission),
  })

  if (res.status === 404 || res.status === 410 || res.status === 403) {
    throw new SupplierTokenInvalidError(
      'This link is no longer valid. Ask the company that sent it for a new one.',
    )
  }
  if (!res.ok) {
    // Never surface the raw upstream body: it can name internal tables and is
    // read by someone outside the organisation.
    throw new NucleosUnavailableError(
      'Your figure could not be saved. Please try again in a few minutes.',
    )
  }
}
