// Which CBAM regime an entity files under.
//
// This used to be the string 'EU', written once in the extraction pipeline and
// nowhere else. That made every document in a UK-first product extract, and
// every case compute, under the wrong regime — and because there was no
// selector, no user could see it or change it.
//
// The two regimes are not variants of each other:
//
//   UK   — charges direct (Scope 1) emissions only; indirect emissions are out
//          of scope until 2029 at the earliest. UK-produced precursor goods are
//          excluded entirely. Output is a tax return filed with HMRC.
//   EU   — charges direct and indirect emissions. Output is a quarterly XML
//          declaration lodged with the EU registry, and certificates rather
//          than a tax charge.
//
// An importer can be exposed to both, which is why BOTH exists — Nucleos's case
// model has carried it since migration 009 and produces both outputs for it.
//
// Pure. No I/O, no database, no Nucleos call: the mapping decisions are the
// thing worth testing, and they should be testable without either.

/** The extraction contract's axis. Only two values cross the boundary. */
export type ContractJurisdiction = 'UK' | 'EU'

/** What an entity can be exposed to. */
export type CbamJurisdiction = 'UK' | 'EU' | 'BOTH'

/** The regulatory output a jurisdiction produces. */
export type ReturnFormat = 'HMRC_RETURN' | 'EU_XML'

export interface JurisdictionOption {
  id: CbamJurisdiction
  label: string
  detail: string
}

/**
 * The choices, in the order they are offered.
 *
 * UK first because that is the product's first market and the answer most
 * users need. Plain English throughout — no regulation numbers, per the design
 * rule that keeps citations off screens an office manager uses.
 */
export const CBAM_JURISDICTIONS: readonly JurisdictionOption[] = [
  {
    id: 'UK',
    label: 'United Kingdom',
    detail:
      'You import into the UK and file a return with HMRC. Only direct emissions ' +
      'are charged, and goods produced in the UK are not counted.',
  },
  {
    id: 'EU',
    label: 'European Union',
    detail:
      'You import into the EU and lodge a quarterly declaration with the EU ' +
      'registry. Both direct and indirect emissions are counted.',
  },
  {
    id: 'BOTH',
    label: 'Both',
    detail:
      'You import into the UK and the EU. Each import produces its own return, ' +
      'under its own rules.',
  },
] as const

const KNOWN = new Set<string>(CBAM_JURISDICTIONS.map(j => j.id))

export function isCbamJurisdiction(value: unknown): value is CbamJurisdiction {
  return typeof value === 'string' && KNOWN.has(value)
}

/**
 * The entity's regime, or the default when it has not answered.
 *
 * The default is UK. Arbor is a UK-first product whose one sentence ends in an
 * HMRC return, so an entity that has never been asked is a UK importer until it
 * says otherwise. Defaulting to EU — as the hardcoded string did — silently put
 * every one of them under the wrong regime.
 */
export function resolveJurisdiction(stored: unknown): CbamJurisdiction {
  return isCbamJurisdiction(stored) ? stored : 'UK'
}

/**
 * What to send across the extraction boundary.
 *
 * The contract carries UK | EU only, so BOTH has to resolve to one of them. It
 * resolves to EU because EU is the superset: the UK regime excludes indirect
 * emissions and UK-origin precursors, so extracting a dual-exposure importer's
 * document under UK rules would drop the fields their EU declaration needs.
 * The UK exclusions are applied downstream, by the HMRC return builder, where
 * they can be applied to a complete extraction rather than an incomplete one.
 */
export function extractionJurisdiction(j: CbamJurisdiction): ContractJurisdiction {
  return j === 'UK' ? 'UK' : 'EU'
}

/**
 * The regulatory outputs available for a jurisdiction.
 *
 * Ordered UK-first for the same reason the options are. A screen offering an EU
 * XML download to a UK-only importer is offering something they can never file.
 */
export function availableReturns(j: CbamJurisdiction): ReturnFormat[] {
  if (j === 'UK') return ['HMRC_RETURN']
  if (j === 'EU') return ['EU_XML']
  return ['HMRC_RETURN', 'EU_XML']
}

/**
 * The regimes a case must be calculated under.
 *
 * Unlike extraction, a calculation cannot fold BOTH into one run. The regimes
 * charge different things — the UK counts direct emissions only and ignores
 * UK-origin precursors — so one figure cannot stand for both, and picking
 * either would understate one return. A dual-exposure importer gets two
 * calculations and sees both.
 */
export function calculationRegimes(j: CbamJurisdiction): ContractJurisdiction[] {
  if (j === 'UK') return ['UK']
  if (j === 'EU') return ['EU']
  return ['UK', 'EU']
}

/** How a single regime is named on screen. */
export const REGIME_LABEL: Record<ContractJurisdiction, string> = {
  UK: 'United Kingdom',
  EU: 'European Union',
}

export function describeJurisdiction(j: CbamJurisdiction): JurisdictionOption {
  return CBAM_JURISDICTIONS.find(o => o.id === j) ?? CBAM_JURISDICTIONS[0]
}
