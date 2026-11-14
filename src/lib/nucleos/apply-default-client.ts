// Recording the published default as a goods line's emissions figure.
//
// Nucleos works the figure out from its own Annex VI table and records it as
// method "default", the same figure its calculation shows. Arbor sends no
// numbers: the figure is Nucleos's to compute. A supplier's figure sent later
// is a higher version and supersedes it.

import { NucleosUnavailableError, isNucleosConfigured } from './extraction-client'
import { nucleosHeaders } from './service-auth'

/** The line already has a figure (Nucleos's unique line-and-version rule). */
export class DefaultAlreadyRecordedError extends Error {
  constructor() {
    super('This goods line already has an emissions figure.')
    this.name = 'DefaultAlreadyRecordedError'
  }
}

/** No Annex VI default is published for these goods, so nothing was recorded. */
export class NoPublishedDefaultError extends Error {
  constructor() {
    super('There is no published default for these goods.')
    this.name = 'NoPublishedDefaultError'
  }
}

export async function applyPublishedDefault(
  goodsLineId: string,
  productionRoute: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!isNucleosConfigured()) {
    throw new NucleosUnavailableError(
      'NUCLEOS_URL or a Nucleos credential (NUCLEOS_OIDC_AUDIENCE or NUCLEOS_INTERNAL_TOKEN) is not configured',
    )
  }
  const res = await fetchImpl(`${process.env.NUCLEOS_URL}/api/cbam/emissions`, {
    method: 'POST',
    headers: await nucleosHeaders({ 'content-type': 'application/json' }),
    cache: 'no-store',
    body: JSON.stringify({
      goods_line_id: goodsLineId,
      calculation_method: 'default',
      // Only offered on a line with no figure, so this is its first record.
      version: 1,
      production_route: productionRoute,
      // Without it, Nucleos records zero when no default exists.
      require_default_factor: true,
    }),
  })
  if (res.ok) return

  const body = (await res.json().catch(() => ({}))) as { detail?: { error?: string } }
  if (res.status === 409) throw new DefaultAlreadyRecordedError()
  if (res.status === 422 && body.detail?.error === 'no_published_default') throw new NoPublishedDefaultError()
  throw new NucleosUnavailableError(`Recording the published default failed: ${res.status}`)
}
