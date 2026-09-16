// Confirmed CBAM fields → the case Nucleos needs to be told about.
//
// This is the producer the CBAM screens never had. Cases, Request data and
// Carbon price relief all read a list that nothing in Arbor could fill: the
// extraction endpoint is deliberately stateless and creates nothing, and the
// confirm route had no handoff at all. Every case in the Nucleos database got
// there by hand.
//
// Pure, and separate from the client that posts it, because the mapping is
// where the decisions are: what makes a goods line usable, what to do with a
// line that is not, and what may never be invented.
//
// Two rules it will not bend:
//
//   No importer, no case. A declaration filed against the wrong identity is
//   worse than a missing one, and Nucleos requires the EORI regardless.
//
//   No invented emissions. A goods line with no supplier figure is sent with no
//   emissions record. Choosing the published default instead is the engine's
//   decision — it carries the legislated mark-up and is recorded as a rejected
//   method with its reason. Writing a zero here would produce a line declaring
//   no emissions rather than one still waiting for a figure.

import { parseGoodsLineFieldName } from './cbam-fields'
import type { CbamJurisdiction } from './jurisdiction'
import { parseNumericValue } from '@/lib/parse-numeric'

/** The three methods Nucleos's emissions endpoint accepts, in its own spelling. */
const CALCULATION_METHODS = new Set(['actual', 'default', 'estimated'])

export interface CasePayloadEmissions {
  direct_emissions_kgco2e: number
  indirect_emissions_kgco2e: number | null
  calculation_method: string
  production_route: string | null
}

export interface CasePayloadLine {
  /** The index in the source extraction, so a problem can name the line. */
  lineIndex: number
  cn_code: string
  product_description: string | null
  net_mass_kg: number
  origin_country: string | null
  installation_id: string | null
  emissions: CasePayloadEmissions | null
}

export interface CasePayload {
  case: {
    importer_eori: string
    importer_name: string | null
    reporting_year: number
    reporting_quarter: number
    jurisdiction: CbamJurisdiction
  }
  shipment: {
    origin_country: string | null
    /** The customs entry reference (MRN), not a procedure code. */
    entry_reference: string | null
    incoterm: string | null
    /** ISO date the goods were imported, when the document said. */
    import_date: string | null
  }
  lines: CasePayloadLine[]
}

export interface BuildCasePayloadInput {
  /** Field name → the value the reviewer confirmed. */
  confirmed: ReadonlyMap<string, string>
  jurisdiction: CbamJurisdiction
  /** The document's reporting period end; sets the year and quarter. */
  reportingPeriodEnd: Date
}

export interface BuildCasePayloadResult {
  /** Null when nothing admissible could be assembled. */
  payload: CasePayload | null
  /**
   * What was dropped or defaulted, in plain English.
   *
   * Never empty when something was lost. A line quietly omitted from a
   * declaration is a short declaration, and it looks exactly like a complete
   * one — the same failure mode the calculation endpoint fails closed on.
   */
  problems: string[]
}

function text(map: ReadonlyMap<string, string>, key: string): string | null {
  const raw = map.get(key)
  if (raw === undefined || raw === null) return null
  const trimmed = String(raw).trim()
  return trimmed === '' ? null : trimmed
}

function numeric(map: ReadonlyMap<string, string>, key: string): number | null {
  const raw = text(map, key)
  if (raw === null) return null
  const parsed = parseNumericValue(raw)
  return parsed === null || !Number.isFinite(parsed) ? null : parsed
}

/** Calendar quarter of a date, 1-4. */
function quarterOf(d: Date): number {
  return Math.floor(d.getUTCMonth() / 3) + 1
}

/**
 * A confirmed date as an ISO day, or null if it does not parse.
 *
 * Null rather than today: the shipment's import date defaults to the day the
 * case was opened, and a wrong date that looks deliberate is worse than an
 * obvious default.
 */
function isoDate(raw: string | null): string | null {
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10)
}

export function buildCasePayload(input: BuildCasePayloadInput): BuildCasePayloadResult {
  const { confirmed, jurisdiction, reportingPeriodEnd } = input
  const problems: string[] = []

  const importerEori = text(confirmed, 'importer_eori')
  if (!importerEori) {
    return {
      payload: null,
      problems: [
        'No importer EORI was confirmed, so no case was opened. Add the EORI to the document and confirm again.',
      ],
    }
  }

  // Group the flat confirmed map back into lines.
  const byLine = new Map<number, Map<string, string>>()
  for (const [name, value] of confirmed) {
    const ref = parseGoodsLineFieldName(name)
    if (!ref) continue
    const line = byLine.get(ref.lineIndex) ?? new Map<string, string>()
    line.set(ref.field, value)
    byLine.set(ref.lineIndex, line)
  }

  const documentOrigin = text(confirmed, 'origin_country')
  const lines: CasePayloadLine[] = []

  for (const lineIndex of [...byLine.keys()].sort((a, b) => a - b)) {
    const line = byLine.get(lineIndex)!
    const cnCode = text(line, 'cn_code')
    const netMass = numeric(line, 'net_mass_kg')

    // A goods line without both a code and a mass cannot be declared: the code
    // selects the sector and the default factor, the mass turns an intensity
    // into a total. Named, never dropped in silence.
    if (!cnCode || netMass === null || netMass <= 0) {
      problems.push(
        `Goods line ${lineIndex + 1} was left out of the case: ` +
          `${!cnCode ? 'it has no commodity code' : 'its weight is missing or not a number'}.`,
      )
      continue
    }

    const direct = numeric(line, 'direct_embedded_kgco2e')
    const indirect = numeric(line, 'indirect_embedded_kgco2e')

    let emissions: CasePayloadEmissions | null = null
    if (direct !== null) {
      const declared = text(line, 'emissions_method')
      let method = (declared ?? 'actual').toLowerCase()
      if (!CALCULATION_METHODS.has(method)) {
        problems.push(
          `Goods line ${lineIndex + 1} declared an emissions method of "${declared}", ` +
            'which is not one Arbor can pass on. It was recorded as a supplier measurement instead.',
        )
        method = 'actual'
      }
      emissions = {
        direct_emissions_kgco2e: direct,
        indirect_emissions_kgco2e: indirect,
        calculation_method: method,
        production_route: text(line, 'production_route'),
      }
    }

    lines.push({
      lineIndex,
      cn_code: cnCode,
      product_description: text(line, 'description'),
      net_mass_kg: netMass,
      origin_country: text(line, 'origin_country') ?? documentOrigin,
      installation_id: text(line, 'installation_id'),
      emissions,
    })
  }

  if (lines.length === 0) {
    problems.push(
      'No goods line had both a commodity code and a weight, so no case was opened.',
    )
    return { payload: null, problems }
  }

  return {
    payload: {
      case: {
        importer_eori: importerEori,
        importer_name: text(confirmed, 'importer_name'),
        reporting_year: reportingPeriodEnd.getUTCFullYear(),
        reporting_quarter: quarterOf(reportingPeriodEnd),
        jurisdiction,
      },
      shipment: {
        origin_country: documentOrigin,
        entry_reference: text(confirmed, 'entry_reference'),
        incoterm: text(confirmed, 'incoterm'),
        import_date: isoDate(text(confirmed, 'import_date') ?? text(confirmed, 'invoice_date')),
      },
      lines,
    },
    problems,
  }
}
