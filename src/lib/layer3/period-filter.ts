// Layer 3 — Access. Pure, read-only. Builds the period clause for a record query.
//
// A user asking "what did we record for 2026?" means every record that covers
// any part of 2026, not only records that sit entirely inside it. The original
// clause required containment (periodStart >= from AND periodEnd <= to), which
// silently dropped anything straddling a boundary — a bill running July to July
// vanished from both years it belongs to.
//
// Two records overlap a window when each starts before the other ends:
//   record.periodStart <= to  AND  record.periodEnd >= from

export interface PeriodWhere {
  periodStart?: { lte: Date }
  periodEnd?: { gte: Date }
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function periodOverlapWhere(
  from: string | null | undefined,
  to: string | null | undefined,
): PeriodWhere {
  const start = parseDate(from)
  const end = parseDate(to)

  const where: PeriodWhere = {}
  // Ends on or after the window opens.
  if (start) where.periodEnd = { gte: start }
  // Starts on or before the window closes.
  if (end) where.periodStart = { lte: end }
  return where
}
