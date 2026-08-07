// Layer 3 — Access. Pure, read-only. No DB, no AI, no value transformation.
//
// "Am I up to date?" — the question an ops manager actually has.
//
// Bills, logs and delivery notes arrive on a cycle. The failure that matters to
// the person keeping them is therefore not a low record count, it is a period
// with nothing in it: the Q2 electricity bill that never got filed. This builds
// that view — the record types this business keeps, against the last four
// quarters — so a gap is visible at a glance instead of being discovered when a
// customer asks.
//
// Three cell states, because "we never got it" and "it arrived and nobody
// confirmed it" are different problems with different fixes.

import { DOMAIN_LABELS } from '@/lib/domain-labels'

// The canonical order used across the product, so rows never reshuffle.
const DOMAIN_ORDER = [
  'ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS',
  'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE',
] as const

const DEFAULT_QUARTERS = 4

export interface Quarter {
  label: string
  year: number
  quarter: number
  start: Date
  end: Date
}

// Only `missing` is a problem. The other two blank states exist because the
// alternative is a red column the user cannot act on: `before_first` is the
// period before this business kept that record type at all, and `in_progress`
// is the quarter still running, whose bill has not arrived yet. Without them a
// new business, and every business for most of every quarter, opens the page to
// gaps it never had — and learns to ignore the grid.
export type CellState =
  | 'recorded'
  | 'awaiting_check'
  | 'missing'
  | 'before_first'
  | 'in_progress'

export interface CoverageCell {
  quarter: Quarter
  state: CellState
  /** Records stored for this type in this quarter. */
  count: number
}

export interface CoverageRow {
  domain: string
  domainLabel: string
  cells: CoverageCell[]
  /** Label of the most recent quarter with a stored record; null when none. */
  lastCovered: string | null
}

/** A period a record or an unconfirmed document covers. */
export interface CoveragePeriod {
  domain: string
  periodStart: Date | string
  periodEnd: Date | string
}

export interface CoverageInput {
  records: CoveragePeriod[]
  /** Documents that arrived but were never confirmed, so hold no records yet. */
  pending: CoveragePeriod[]
  now: Date
  quarterCount?: number
}

function quarterOf(date: Date): { year: number; quarter: number } {
  return { year: date.getUTCFullYear(), quarter: Math.floor(date.getUTCMonth() / 3) + 1 }
}

function makeQuarter(year: number, quarter: number): Quarter {
  const startMonth = (quarter - 1) * 3
  return {
    label: `Q${quarter} ${year}`,
    year,
    quarter,
    start: new Date(Date.UTC(year, startMonth, 1)),
    // Day 0 of the following month is the last day of this one.
    end: new Date(Date.UTC(year, startMonth + 3, 0)),
  }
}

/** The last `count` quarters, oldest first, ending with the one containing `now`. */
export function recentQuarters(now: Date, count: number = DEFAULT_QUARTERS): Quarter[] {
  const { year, quarter } = quarterOf(now)
  const quarters: Quarter[] = []
  for (let back = count - 1; back >= 0; back--) {
    // Walk back in quarters, letting the arithmetic carry across year boundaries.
    const absolute = year * 4 + (quarter - 1) - back
    quarters.push(makeQuarter(Math.floor(absolute / 4), (absolute % 4) + 1))
  }
  return quarters
}

/** Does [aStart, aEnd] share any day with [bStart, bEnd]? */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart <= bEnd && aEnd >= bStart
}

function toRange(p: CoveragePeriod): { start: Date; end: Date } | null {
  const start = new Date(p.periodStart)
  const end = new Date(p.periodEnd)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  return { start, end }
}

export function buildPeriodCoverage(input: CoverageInput): CoverageRow[] {
  const { records, pending, now, quarterCount } = input
  const quarters = recentQuarters(now, quarterCount ?? DEFAULT_QUARTERS)

  // Only the record types this business actually keeps. Showing a row for
  // Agriculture to a steel stockholder invents a gap that does not exist.
  const kept = new Set([...records, ...pending].map(p => p.domain))
  if (kept.size === 0) return []

  return DOMAIN_ORDER.filter(d => kept.has(d)).map(domain => {
    // Filter by domain before parsing, so an unparseable period cannot shift
    // the alignment between a range and the row it belongs to.
    const isRange = (r: { start: Date; end: Date } | null): r is { start: Date; end: Date } => r !== null
    const domainRecords = records.filter(r => r.domain === domain).map(toRange).filter(isRange)
    const domainPending = pending.filter(p => p.domain === domain).map(toRange).filter(isRange)

    // The point this business started keeping this kind of record. Quarters
    // before it are not gaps.
    const firstActivity = [...domainRecords, ...domainPending]
      .map(r => r.start.getTime())
      .reduce((min, t) => Math.min(min, t), Number.POSITIVE_INFINITY)

    let lastCovered: string | null = null

    const cells: CoverageCell[] = quarters.map(quarter => {
      const count = domainRecords.filter(
        r => overlaps(r.start, r.end, quarter.start, quarter.end),
      ).length

      if (count > 0) {
        lastCovered = quarter.label
        return { quarter, state: 'recorded', count }
      }

      const awaiting = domainPending.some(
        r => overlaps(r.start, r.end, quarter.start, quarter.end),
      )
      if (awaiting) return { quarter, state: 'awaiting_check', count: 0 }

      if (quarter.end.getTime() < firstActivity) {
        return { quarter, state: 'before_first', count: 0 }
      }
      // The quarter we are still living through is not yet owed anything.
      if (now <= quarter.end) return { quarter, state: 'in_progress', count: 0 }

      return { quarter, state: 'missing', count: 0 }
    })

    return {
      domain,
      domainLabel: DOMAIN_LABELS[domain] ?? domain,
      cells,
      lastCovered,
    }
  })
}
