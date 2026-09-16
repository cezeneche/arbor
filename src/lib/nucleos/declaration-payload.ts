// A Nucleos case, as read back, → the declaration the calculation engine takes.
//
// Two axes travel on every line and they are not the same question:
//
//   provenance_tier   — how well evidenced the record is. Arbor's axis, set by a
//                       human in Review, never by Nucleos and never by a model.
//   emissions_method  — which figure entered the calculation. Nucleos's axis,
//                       decided by the selector, which may reject the declared
//                       one and say why.
//
// A mill certificate can legitimately be an ACTUAL measurement and a DECLARED
// record, because the figure is real and the document backing it was never
// verified. Collapsing the two loses one of the two questions a reviewer has to
// answer, so this module carries both and derives neither from the other.
//
// Pure. The provenance tier arrives as an argument rather than being looked up
// here, because a lookup would make the mapping untestable without a database.

import type {
  DeclarationLine,
  DeclarationPayload,
  EmissionsMethod,
  Jurisdiction,
  ProvenanceTier,
} from './contract'

/** A goods line as the case-detail endpoint returns it. Column names vary by
 *  schema generation, so both spellings of mass are accepted. */
export interface CaseGoodsLine {
  id?: unknown
  cn_code?: unknown
  net_mass_kg?: unknown
  quantity?: unknown
  origin_country?: unknown
  production_route?: unknown
  installation_id?: unknown
  direct_kgco2e?: unknown
  indirect_kgco2e?: unknown
  method?: unknown
  [key: string]: unknown
}

const METHODS = new Set<EmissionsMethod>(['ACTUAL', 'ESTIMATED', 'DEFAULT'])

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export interface BuildDeclarationInput {
  caseReference: string
  entityId: string
  jurisdiction: Jurisdiction
  reportingYear: number
  reportingQuarter?: number | null
  goodsLines: readonly CaseGoodsLine[]
  /**
   * The tier a human set in Review, for every line on this case.
   *
   * One value, not one per line: every record from a confirmation is written
   * with a single derived tier, and the goods lines of a case all come from one
   * confirmed document. Passing it in keeps the derivation where it belongs —
   * in Layer 2, at write time — rather than re-deciding it here.
   */
  provenanceTier: ProvenanceTier
}

export interface BuildDeclarationResult {
  payload: DeclarationPayload | null
  /** Lines that could not be declared, named. Never a silent omission. */
  problems: string[]
}

export function buildDeclarationPayload(
  input: BuildDeclarationInput,
): BuildDeclarationResult {
  const problems: string[] = []
  const lines: DeclarationLine[] = []

  input.goodsLines.forEach((raw, index) => {
    const lineId = str(raw.id) ?? `line-${index + 1}`
    const cnCode = str(raw.cn_code)
    const mass = num(raw.net_mass_kg) ?? num(raw.quantity)

    if (!cnCode || mass === null || mass <= 0) {
      problems.push(
        `Goods line ${index + 1} cannot be calculated: ` +
          `${!cnCode ? 'it has no commodity code' : 'its weight is missing'}.`,
      )
      return
    }

    const declared = str(raw.method)?.toUpperCase()
    const declaredMethod =
      declared && METHODS.has(declared as EmissionsMethod)
        ? (declared as EmissionsMethod)
        : null
    if (declared && !declaredMethod) {
      problems.push(
        `Goods line ${index + 1} records an emissions method of "${declared}", ` +
          'which the engine does not recognise. It was left for the engine to choose.',
      )
    }

    lines.push({
      line_id: lineId,
      cn_code: cnCode,
      net_mass_kg: mass,
      origin_country: str(raw.origin_country),
      production_route: str(raw.production_route),
      installation_id: str(raw.installation_id),
      direct_embedded_kgco2e: num(raw.direct_kgco2e),
      indirect_embedded_kgco2e: num(raw.indirect_kgco2e),
      // Echoed on to the result so a goods line displays both axes without
      // Arbor having to re-join them afterwards.
      provenance_tier: input.provenanceTier,
      declared_emissions_method: declaredMethod,
    })
  })

  if (lines.length === 0) {
    problems.push('This case has no goods line that can be calculated.')
    return { payload: null, problems }
  }

  return {
    payload: {
      case_reference: input.caseReference,
      entity_id: input.entityId,
      jurisdiction: input.jurisdiction,
      reporting_year: input.reportingYear,
      reporting_quarter: input.reportingQuarter ?? null,
      lines,
    },
    problems,
  }
}

/** Arbor's trust tier → the contract's provenance axis. */
export function toProvenanceTier(trustTier: string | null | undefined): ProvenanceTier {
  if (trustTier === 'A') return 'VERIFIED'
  if (trustTier === 'C') return 'ESTIMATED'
  // B, and anything unrecognised. Declared is the honest floor: it claims only
  // that someone stated the figure, which is true of every record there is.
  return 'DECLARED'
}
