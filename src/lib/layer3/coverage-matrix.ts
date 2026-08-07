// Layer 3 — Access. Pure, read-only. §6: the coverage matrix.
//
// Record types the org keeps, against the last eight periods. This is the
// difference between the data the org has and the data it owes, which is the
// whole reason the Overview exists.
//
// A cell reports the WEAKEST tier present in that period, never the best. A
// quarter holding one Verified and one Declared record cannot be shown as
// Verified — the same meet rule every other aggregate claim in the product
// uses. Red is reserved for `missing` and means nothing else.

import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { meetTier, type Tier } from './tier-composition'
import type { Period } from './declaration-period'

// The canonical order, so rows never reshuffle between renders.
const DOMAIN_ORDER = [
  'ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS',
  'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE',
] as const

export type CoverageCellState =
  | 'verified'
  | 'declared'
  | 'estimated'
  | 'missing'
  | 'out_of_scope'

export interface CoverageRecord {
  domain: string
  trustTier: Tier
  periodStart: Date | string
  periodEnd: Date | string
  documentName?: string | null
}

export interface CoverageCell {
  period: Period
  state: CoverageCellState
  recordCount: number
  sourceDocument: string | null
}

export interface CoverageRow {
  domain: string
  label: string
  cells: CoverageCell[]
  /** Label of the most recent period covered; null when none in the window. */
  lastRecorded: string | null
}

const TIER_STATE: Record<Tier, CoverageCellState> = {
  A: 'verified',
  B: 'declared',
  C: 'estimated',
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart <= bEnd && aEnd >= bStart
}

function range(r: CoverageRecord): { start: Date; end: Date } | null {
  const start = new Date(r.periodStart)
  const end = new Date(r.periodEnd)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  return { start, end }
}

export interface CoverageInput {
  records: CoverageRecord[]
  periods: Period[]
  /** Periods that closed before the org joined are out of scope, not gaps. */
  onboardedAt: Date
}

export function buildCoverageMatrix(input: CoverageInput): CoverageRow[] {
  const { records, periods, onboardedAt } = input

  const kept = new Set(records.map(r => r.domain))
  if (kept.size === 0) return []

  return DOMAIN_ORDER.filter(d => kept.has(d)).map(domain => {
    const own = records
      .filter(r => r.domain === domain)
      .map(r => ({ record: r, range: range(r) }))
      .filter((x): x is { record: CoverageRecord; range: { start: Date; end: Date } } => x.range !== null)

    let lastRecorded: string | null = null

    const cells: CoverageCell[] = periods.map(period => {
      const inPeriod = own.filter(x =>
        overlaps(x.range.start, x.range.end, period.start, period.end),
      )

      if (inPeriod.length > 0) {
        // Weakest tier present wins.
        const tier = inPeriod
          .map(x => x.record.trustTier)
          .reduce<Tier>((acc, t) => meetTier(acc, t), 'A')
        lastRecorded = period.label
        return {
          period,
          state: TIER_STATE[tier],
          recordCount: inPeriod.length,
          sourceDocument: inPeriod.find(x => x.record.documentName)?.record.documentName ?? null,
        }
      }

      const outOfScope = period.end < onboardedAt
      return {
        period,
        state: outOfScope ? 'out_of_scope' : 'missing',
        recordCount: 0,
        sourceDocument: null,
      }
    })

    return { domain, label: DOMAIN_LABELS[domain] ?? domain, cells, lastRecorded }
  })
}

const WORDS = [
  'No', 'One', 'Two', 'Three', 'Four', 'Five',
  'Six', 'Seven', 'Eight', 'Nine', 'Ten',
]

const inWords = (n: number) => (n <= 10 ? WORDS[n] : String(n))

/** The gap stated in words, e.g. "Three record types, eight quarters. One gap." */
export function summariseCoverage(rows: CoverageRow[]): string {
  if (rows.length === 0) return 'No record types yet.'

  const quarters = rows[0].cells.length
  const gaps = rows.reduce(
    (n, row) => n + row.cells.filter(c => c.state === 'missing').length,
    0,
  )

  const types = `${inWords(rows.length)} record type${rows.length === 1 ? '' : 's'}`
  const span = `${inWords(quarters).toLowerCase()} quarters`
  const gapText = gaps === 0 ? 'No gaps.' : `${inWords(gaps)} gap${gaps === 1 ? '' : 's'}.`

  return `${types}, ${span}. ${gapText}`
}
