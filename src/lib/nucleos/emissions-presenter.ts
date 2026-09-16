// A calculation result → the strings the emissions view shows.
//
// Pure and separate from the page, because the decisions here are the ones that
// can mislead. Three of them in particular:
//
//   Both axes always show. `emissions_method` says which figure entered the
//   calculation; `provenance_tier` says how well evidenced the record behind it
//   is. Showing one is not showing the other, and a line whose figure is a real
//   measurement on an unverified document is a common and important case.
//
//   A rejected method keeps its regulation reference. "Actual data was not
//   used" without the reason and the citation is an assertion; with them it is
//   an audit trail, which is the whole point of the field.
//
//   The mark-up is named when it applied. It is deliberate policy — priced so
//   that collecting real data is cheaper than not collecting it — and a user
//   looking at a higher figure than they expected is owed the reason. The
//   percentage comes from the result, never from a second copy in TypeScript
//   that would drift from Nucleos's versioned table.

import type {
  CalculatedLine,
  CalculationResult,
  DecisionAtom,
  EmissionsMethod,
  ProvenanceTier,
  RejectedMethod,
} from './contract'

/** Plain English for Nucleos's method axis. */
const METHOD_LABEL: Record<EmissionsMethod, string> = {
  ACTUAL: 'Measured',
  ESTIMATED: 'Estimated',
  DEFAULT: 'Published default',
}

const METHOD_DETAIL: Record<EmissionsMethod, string> = {
  ACTUAL: 'A figure from the installation that made the goods.',
  ESTIMATED: 'Derived from the information available, not measured at the installation.',
  DEFAULT: 'The published value for this product and production route was applied.',
}

/** Arbor's provenance axis, in the labels the rest of the product uses. */
const PROVENANCE_LABEL: Record<ProvenanceTier, string> = {
  VERIFIED: 'Verified',
  DECLARED: 'Declared',
  ESTIMATED: 'Estimated',
}

export interface PresentedRejection {
  method: string
  reason: string
  regulationRef: string
}

export interface PresentedLine {
  lineId: string
  /** "Measured" / "Estimated" / "Published default". */
  method: string
  methodDetail: string
  /** "Verified" / "Declared" / "Estimated". Never derived from the method. */
  provenance: string
  direct: string
  indirect: string
  /** Specific embedded emissions, tCO2e per tonne, or an em-dash. */
  seeTotal: string
  embedded: string
  /** Present only when a mark-up applied, e.g. "Includes a 20% mark-up". */
  markupNote: string | null
  /** Why a higher-priority method was not used. Empty when none was rejected. */
  rejections: PresentedRejection[]
  /** The engine's own trace, verbatim. */
  trace: DecisionAtom[]
  warnings: string[]
}

export interface PresentedCalculation {
  caseReference: string
  jurisdiction: string
  period: string
  lines: PresentedLine[]
  /** Sum across lines as the engine reported it, or an em-dash. */
  totalEmbedded: string
  warnings: string[]
  /** Which engine and which tables produced these figures. */
  provenanceStamp: string
}

const DASH = '—'

function tonnes(kg: number | null | undefined): string {
  if (typeof kg !== 'number' || !Number.isFinite(kg)) return DASH
  return `${(kg / 1000).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} tCO2e`
}

function intensity(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DASH
  return `${value.toLocaleString('en-GB', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })} tCO2e/t`
}

function presentRejections(rejected: RejectedMethod[] | undefined): PresentedRejection[] {
  return (rejected ?? []).map(r => ({
    method: METHOD_LABEL[r.method] ?? String(r.method),
    reason: r.reason,
    // The citation travels verbatim. A rejection without it is an assertion.
    regulationRef: r.regulation_ref,
  }))
}

function markupNote(line: CalculatedLine): string | null {
  const fraction = line.markup_fraction
  if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction <= 0) return null
  const percent = (fraction * 100).toLocaleString('en-GB', { maximumFractionDigits: 1 })
  return (
    `Includes the legislated ${percent}% mark-up, which applies because a published ` +
    'default was used instead of a figure from the installation.'
  )
}

export function presentLine(line: CalculatedLine): PresentedLine {
  return {
    lineId: line.line_id,
    method: METHOD_LABEL[line.emissions_method] ?? String(line.emissions_method),
    methodDetail: METHOD_DETAIL[line.emissions_method] ?? '',
    provenance: PROVENANCE_LABEL[line.provenance_tier] ?? String(line.provenance_tier),
    direct: tonnes(line.direct_kgco2e),
    indirect: tonnes(line.indirect_kgco2e),
    seeTotal: intensity(line.see_total_tco2e_per_t),
    embedded:
      typeof line.embedded_tco2e === 'number' && Number.isFinite(line.embedded_tco2e)
        ? `${line.embedded_tco2e.toLocaleString('en-GB', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} tCO2e`
        : DASH,
    markupNote: markupNote(line),
    rejections: presentRejections(line.rejected_methods),
    trace: line.decision_trace ?? [],
    warnings: line.warnings ?? [],
  }
}

export function presentCalculation(result: CalculationResult): PresentedCalculation {
  const period =
    result.reporting_quarter == null
      ? String(result.reporting_year)
      : `Q${result.reporting_quarter} ${result.reporting_year}`

  const total = result.total_embedded_tco2e
  const engine = result.engine

  // Named tables, not "calculated by Arbor". A figure that cannot say which
  // versions of which tables produced it cannot be reproduced once those tables
  // move on, and regulatory tables are versioned precisely because they do.
  const stampParts = [`engine ${engine.engine_version}`]
  if (engine.annex_vi_factor_version) stampParts.push(`factors ${engine.annex_vi_factor_version}`)
  if (engine.markup_table_version) stampParts.push(`mark-up table ${engine.markup_table_version}`)
  if (engine.regulation_reference) stampParts.push(engine.regulation_reference)

  return {
    caseReference: result.case_reference,
    jurisdiction: result.jurisdiction,
    period,
    lines: result.lines.map(presentLine),
    totalEmbedded:
      typeof total === 'number' && Number.isFinite(total)
        ? `${total.toLocaleString('en-GB', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} tCO2e`
        : DASH,
    warnings: result.warnings ?? [],
    provenanceStamp: stampParts.join(' · '),
  }
}
