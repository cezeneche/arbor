// Asking Nucleos to write a CBAM case's audit narrative.
//
// Nucleos builds the compliance pack: one Claude call writes the prose, the
// figures are overwritten from the report package, and a deterministic
// validator decides whether a person must review it. Arbor keeps the narrative,
// the verdict and the pack's hash; the rest of the pack is Nucleos's.

import { NucleosUnavailableError, isNucleosConfigured } from './extraction-client'
import { nucleosHeaders } from './service-auth'

/** Nucleos refused because Arbor's service token lacks the narrative:run scope. */
export class NarrativeNotAllowedError extends Error {
  constructor() {
    super('The service token does not carry the narrative:run scope.')
    this.name = 'NarrativeNotAllowedError'
  }
}

/** The case has gaps that stop a narrative being written. */
export class NarrativeBlockedError extends Error {
  constructor(readonly missing: string[]) {
    super('The case has data gaps that block the narrative.')
    this.name = 'NarrativeBlockedError'
  }
}

export interface CompliancePackResult {
  narrative: Record<string, unknown>
  review: { required: boolean; reasons: string[] }
  packHash: string | null
}

// One Claude call of up to a minute, after Nucleos's own cold start.
const TIMEOUT_MS = 110_000

export async function runCompliancePack(
  caseId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CompliancePackResult> {
  if (!isNucleosConfigured()) {
    throw new NucleosUnavailableError(
      'NUCLEOS_URL or a Nucleos credential (NUCLEOS_OIDC_AUDIENCE or NUCLEOS_INTERNAL_TOKEN) is not configured',
    )
  }
  const path = `/api/cbam/cases/${encodeURIComponent(caseId)}/compliance-pack`
  let res: Response
  try {
    res = await fetchImpl(`${process.env.NUCLEOS_URL}${path}`, {
      method: 'POST',
      headers: await nucleosHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw new NucleosUnavailableError(`Nucleos request failed for ${path}: ${(err as Error).message}`)
  }

  if (res.status === 403) throw new NarrativeNotAllowedError()
  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as { data_quality?: { missing?: unknown } }
    const missing = Array.isArray(body.data_quality?.missing) ? body.data_quality!.missing.map(String) : []
    throw new NarrativeBlockedError(missing)
  }
  if (!res.ok) throw new NucleosUnavailableError(`Nucleos returned ${res.status} for ${path}`)

  const pack = (await res.json()) as {
    narrative?: Record<string, unknown>
    review?: { required?: unknown; reasons?: unknown }
    audit?: { payload_hash?: unknown }
  }
  // A pack without a verdict is treated as needing review: silence is not a pass.
  const review =
    pack.review && typeof pack.review.required === 'boolean'
      ? {
          required: pack.review.required,
          reasons: Array.isArray(pack.review.reasons) ? pack.review.reasons.map(String) : [],
        }
      : { required: true, reasons: ['Nucleos did not say whether this narrative needs review.'] }
  return {
    narrative: pack.narrative ?? {},
    review,
    packHash: typeof pack.audit?.payload_hash === 'string' ? pack.audit.payload_hash : null,
  }
}
