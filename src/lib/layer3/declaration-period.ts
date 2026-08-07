// Layer 3 — Access. Pure, read-only. The declaration calendar the Overview is
// organised around.
//
// Coverage only matters because a period closes. The countdown is therefore
// derived from the close date every render, never written into copy.

export interface Period {
  label: string
  year: number
  quarter: number
  start: Date
  end: Date
}

export interface DeclarationPeriod extends Period {
  quarterLabel: string
  closesOn: Date
  daysToClose: number
}

const MS_PER_DAY = 86_400_000

function quarterFor(year: number, quarter: number): Period {
  const startMonth = (quarter - 1) * 3
  return {
    label: `Q${quarter} ${year}`,
    year,
    quarter,
    start: new Date(Date.UTC(year, startMonth, 1)),
    // Day 0 of the next month is the last day of this one.
    end: new Date(Date.UTC(year, startMonth + 3, 0)),
  }
}

function quarterOf(date: Date): { year: number; quarter: number } {
  return { year: date.getUTCFullYear(), quarter: Math.floor(date.getUTCMonth() / 3) + 1 }
}

/** Midnight UTC on the given date, so day arithmetic is not skewed by the clock. */
function atMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

export function currentDeclarationPeriod(now: Date): DeclarationPeriod {
  const { year, quarter } = quarterOf(now)
  const period = quarterFor(year, quarter)
  const daysToClose = Math.max(
    0,
    Math.round((atMidnight(period.end) - atMidnight(now)) / MS_PER_DAY),
  )
  return {
    ...period,
    quarterLabel: `Q${quarter}`,
    closesOn: period.end,
    daysToClose,
  }
}

/** The last `count` quarters, oldest first, ending with the one containing `now`. */
export function lastPeriods(now: Date, count: number): Period[] {
  const { year, quarter } = quarterOf(now)
  const periods: Period[] = []
  for (let back = count - 1; back >= 0; back--) {
    const absolute = year * 4 + (quarter - 1) - back
    periods.push(quarterFor(Math.floor(absolute / 4), (absolute % 4) + 1))
  }
  return periods
}
