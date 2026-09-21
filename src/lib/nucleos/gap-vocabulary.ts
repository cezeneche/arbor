// Making a case's open gaps readable without losing them.
//
// The data-quality check returns tokens: `case:importer_eori_missing`,
// `goods_line:<uuid>:cn_code_missing`, `shipment:<uuid>:origin_country_missing`.
// They are precise and unreadable, and they are what stands between a case and
// a return — a blocking gap is why the report package and the EU declaration
// refuse to build.
//
// Same rule as `flag-vocabulary`: the plain sentence goes in front of the raw
// token and never replaces it. A user needs to know what to go and fix; a
// support conversation needs the token.
//
// An unrecognised token still shows. A vocabulary that dropped what it did not
// know would hide the gap that is blocking the return, and the user would be
// left with a refusal and no reason.

export type GapSeverity = 'blocking' | 'advisory'

export interface ExplainedGap {
  /** The original token, always preserved. */
  raw: string
  /** What is missing, in plain English. */
  what: string
  /** Which part of the case it is on: "This case", "A consignment", "A goods line". */
  where: string
  severity: GapSeverity
}

/** The field part of a token, whatever prefix it carries. */
function fieldOf(token: string): string {
  const parts = token.split(':')
  return parts[parts.length - 1] ?? token
}

function whereOf(token: string): string {
  if (token.startsWith('case:')) return 'This case'
  if (token.startsWith('shipment:')) return 'A consignment'
  if (token.startsWith('goods_line:')) return 'A goods line'
  return 'This case'
}

const FIELD_WORDS: Record<string, string> = {
  importer_eori_missing: 'the importer’s EORI number',
  reporting_year_missing: 'the reporting year',
  reporting_quarter_missing: 'the reporting quarter',
  origin_country_missing: 'the country the goods came from',
  cn_code_missing: 'the commodity code',
  net_mass_kg_missing: 'the weight of the goods',
  quantity_missing: 'the weight of the goods',
  emissions_missing: 'an emissions figure',
  direct_kgco2e_missing: 'the direct emissions figure',
  installation_id_missing: 'the installation the goods were made at',
  production_route_missing: 'how the goods were produced',
  entry_reference_missing: 'the customs entry reference',
  invoice_number_missing: 'the invoice number',
  incoterm_missing: 'the delivery terms',
  import_date_missing: 'the date the goods were imported',
  sector_missing: 'the sector the goods belong to',
}

/**
 * One token → one sentence.
 *
 * Unrecognised tokens are de-underscored rather than guessed at:
 * `foo_bar_missing` reads as "foo bar", which is honest about what is known.
 */
export function explainGap(token: string, severity: GapSeverity): ExplainedGap {
  const field = fieldOf(token)
  const known = FIELD_WORDS[field]
  const what =
    known ??
    field
      .replace(/_missing$/, '')
      .replace(/_/g, ' ')
      .trim()

  return { raw: token, what, where: whereOf(token), severity }
}

export interface CaseGaps {
  blocking: ExplainedGap[]
  advisory: ExplainedGap[]
  /** True when a return cannot be produced until the blocking gaps are closed. */
  blocksReturn: boolean
  /** One line summarising the state, or null when there is nothing to say. */
  summary: string | null
}

interface RawDataQuality {
  missing?: unknown
  warnings?: unknown
  blocking?: unknown
}

/**
 * The `open_gaps` block from a case, presented.
 *
 * Blocking and advisory are kept apart because the actions differ: a blocking
 * gap has to be closed before anything can be filed, and an advisory one is
 * worth knowing and does not stop the return. Merging them into one list of
 * "issues" would make a user chase the wrong one first.
 */
export function presentGaps(raw: unknown): CaseGaps {
  const dq = (raw ?? {}) as RawDataQuality
  const missing = Array.isArray(dq.missing) ? dq.missing.map(String) : []
  const warnings = Array.isArray(dq.warnings) ? dq.warnings.map(String) : []

  const blocking = missing.map(t => explainGap(t, 'blocking'))
  const advisory = warnings.map(t => explainGap(t, 'advisory'))
  const blocksReturn = blocking.length > 0

  let summary: string | null = null
  if (blocksReturn) {
    summary =
      `${blocking.length} thing${blocking.length === 1 ? '' : 's'} still missing. ` +
      `Your return cannot be produced until ${blocking.length === 1 ? 'it is' : 'they are'} filled in.`
  } else if (advisory.length > 0) {
    summary =
      `${advisory.length} thing${advisory.length === 1 ? '' : 's'} worth checking. ` +
      'None of them stops your return.'
  }

  return { blocking, advisory, blocksReturn, summary }
}
