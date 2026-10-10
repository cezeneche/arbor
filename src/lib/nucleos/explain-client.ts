// Asking Nucleos what a goods line's figure rests on.
//
// Nucleos answers from the evidence Arbor sent when the case was opened. A case
// opened before Arbor sent any has none, and Nucleos says so with a 404: that is
// an answer ("nothing recorded"), not a failure. Anything else fails closed.

import { NucleosUnavailableError, isNucleosConfigured } from './extraction-client'
import { nucleosHeaders } from './service-auth'

export interface ExplainResponse {
  chosen_value?: unknown
  evidence?: unknown
}

export async function explainGoodsLineField(
  caseId: string,
  goodsLineId: string,
  field: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<ExplainResponse | null> {
  if (!isNucleosConfigured()) {
    throw new NucleosUnavailableError(
      'NUCLEOS_URL or a Nucleos credential (NUCLEOS_OIDC_AUDIENCE or NUCLEOS_INTERNAL_TOKEN) is not configured',
    )
  }
  const query = new URLSearchParams({ field: `goods_lines.${goodsLineId}.${field}` })
  const path = `/api/cbam/cases/${encodeURIComponent(caseId)}/explain?${query.toString()}`
  let res: Response
  try {
    res = await (opts.fetchImpl ?? fetch)(`${process.env.NUCLEOS_URL}${path}`, {
      headers: await nucleosHeaders(),
      cache: 'no-store',
    })
  } catch (err) {
    throw new NucleosUnavailableError(`Nucleos request failed for ${path}: ${(err as Error).message}`)
  }
  if (res.status === 404) return null
  if (!res.ok) throw new NucleosUnavailableError(`Nucleos returned ${res.status} for ${path}`)
  return (await res.json()) as ExplainResponse
}
