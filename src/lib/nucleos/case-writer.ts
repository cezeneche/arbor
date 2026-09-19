// Creating a CBAM case in Nucleos from a confirmed Arbor document.
//
// The one write across this boundary. Everything else Arbor sends Nucleos is a
// question — extract this text, calculate these lines, price this relief — and
// this is the only call that leaves state behind, which is why it is the only
// one that has to think about what a half-finished sequence looks like.
//
// Four posts, in order: case, shipment, goods line, emissions. Nucleos has no
// endpoint that takes them together, and adding one would put Arbor's document
// shape inside Nucleos's API. So the sequence is here, and so is its failure
// handling.
//
// It does NOT roll back. A case with two of its three goods lines is a case an
// importer can see, name and finish; a case deleted on the way out is silent.
// So a partial result is returned as a partial result — the case id it did
// create, and one problem line per thing that did not land. The caller records
// both. The one thing that is never returned is a case id with no explanation
// of what is missing from it.
//
// Layer: this reads confirmed Arbor records and hands them to the calculation
// engine. Nothing here writes to Arbor's database and nothing here calculates —
// the recording of the resulting case id is the caller's Layer 2 write.

import { NucleosUnavailableError, isNucleosConfigured } from './extraction-client'
import type { CasePayload } from './case-payload'
import { nucleosHeaders } from './service-auth'

const DEFAULT_TIMEOUT_MS = 30_000

export interface CaseWriteOptions {
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface CaseWriteResult {
  /** Null when the case itself could not be created. */
  caseId: string | null
  /** Nucleos goods-line ids, in the order they were created. */
  goodsLineIds: string[]
  /** What did not land, in plain English. Empty means everything did. */
  problems: string[]
}

async function post<T>(
  path: string,
  body: unknown,
  opts: CaseWriteOptions,
): Promise<T> {
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
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new NucleosUnavailableError(
        `Nucleos returned ${res.status} for ${path}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      )
    }
    return (await res.json()) as T
  } catch (err) {
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

function idOf(row: unknown, what: string): string {
  const id = (row as { id?: unknown })?.id
  if (typeof id !== 'string' || id.trim() === '') {
    throw new NucleosUnavailableError(`Nucleos created a ${what} but returned no id`)
  }
  return id
}

export async function createCbamCase(
  payload: CasePayload,
  opts: CaseWriteOptions = {},
): Promise<CaseWriteResult> {
  const problems: string[] = []

  const caseRow = await post<Record<string, unknown>>('/api/cbam/cases', payload.case, opts)
  const caseId = idOf(caseRow, 'case')

  // From here the case exists. Nothing below throws out of the function: a
  // failure after this point leaves a real case that the user can see, and the
  // honest report of it is the id plus what is missing.
  let shipmentId: string
  try {
    const shipmentRow = await post<Record<string, unknown>>(
      '/api/cbam/shipments',
      { cbam_case_id: caseId, ...payload.shipment },
      opts,
    )
    shipmentId = idOf(shipmentRow, 'shipment')
  } catch (err) {
    return {
      caseId,
      goodsLineIds: [],
      problems: [
        `The case was opened but its consignment could not be added, so it has no goods on it yet: ${(err as Error).message}`,
      ],
    }
  }

  const goodsLineIds: string[] = []
  for (const line of payload.lines) {
    let goodsLineId: string
    try {
      const lineRow = await post<Record<string, unknown>>(
        '/api/cbam/goods-lines',
        {
          shipment_id: shipmentId,
          cn_code: line.cn_code,
          product_description: line.product_description,
          net_mass_kg: line.net_mass_kg,
          installation_id: line.installation_id,
        },
        opts,
      )
      goodsLineId = idOf(lineRow, 'goods line')
    } catch (err) {
      problems.push(
        `Goods line ${line.lineIndex + 1} (${line.cn_code}) could not be added to the case: ${(err as Error).message}`,
      )
      continue
    }

    goodsLineIds.push(goodsLineId)

    if (!line.emissions) continue
    try {
      await post('/api/cbam/emissions', {
        goods_line_id: goodsLineId,
        direct_emissions_kgco2e: line.emissions.direct_emissions_kgco2e,
        indirect_emissions_kgco2e: line.emissions.indirect_emissions_kgco2e,
        calculation_method: line.emissions.calculation_method,
        // First emissions record for this line. Nucleos versions them so a
        // later supplier figure supersedes rather than overwrites.
        version: 1,
        production_route: line.emissions.production_route,
      }, opts)
    } catch (err) {
      // The line is on the case; only its figure is missing. Said plainly,
      // because the line will otherwise fall to the published default and the
      // user will not know why their supplier's figure was not used.
      problems.push(
        `Goods line ${line.lineIndex + 1} (${line.cn_code}) is on the case, but its emissions figure ` +
          `could not be recorded: ${(err as Error).message}`,
      )
    }
  }

  return { caseId, goodsLineIds, problems }
}
