// Proportionate resolution deadlines for validation flags. Pure policy: no DB,
// and `now` is always injected so nothing here depends on a wall clock.
//
// The proportionality judgement matches the one already made in the auto-accept
// physics gate: CRITICAL gets a short clock, WARNING gets a long one, INFO gets
// none. Putting a deadline on every flag would bury a five-person stockholder's
// office manager in obligations they cannot meet, and a control that is always
// breached is worse than no control — it looks like governance while providing
// none.
//
// The windows are one tunable knob (SLA_WINDOW_DAYS) if that judgement changes.

export type FlagSeverity = 'INFO' | 'WARNING' | 'CRITICAL'

export const SLA_WINDOW_DAYS: Record<FlagSeverity, number | null> = {
  CRITICAL: 3,
  WARNING: 14,
  INFO: null,
}

const DAY_MS = 24 * 60 * 60 * 1000

/** When a flag of this severity must be resolved by. null means no deadline. */
export function dueDateFor(severity: FlagSeverity, assignedAt: Date): Date | null {
  const days = SLA_WINDOW_DAYS[severity]
  if (days === null) return null
  return new Date(assignedAt.getTime() + days * DAY_MS)
}

export interface SlaFlag {
  id: string
  severity: FlagSeverity
  assigneeId: string | null
  dueAt: Date | null
  resolvedAt: Date | null
  escalatedAt: Date | null
}

export type EscalationState =
  | 'RESOLVED'
  | 'NO_SLA'
  | 'ON_TRACK'
  | 'DUE_SOON'
  | 'OVERDUE'
  | 'ESCALATED'

const DUE_SOON_WINDOW_MS = DAY_MS

/**
 * Where a flag stands against its deadline. Resolution wins over everything —
 * a closed flag is never overdue however long it sat. An unowned flag is still
 * assessed, because "overdue and nobody's job" is the state most worth seeing.
 */
export function escalationState(flag: SlaFlag, now: Date): EscalationState {
  if (flag.resolvedAt) return 'RESOLVED'
  if (flag.escalatedAt) return 'ESCALATED'
  if (!flag.dueAt) return 'NO_SLA'

  const remaining = flag.dueAt.getTime() - now.getTime()
  if (remaining <= 0) return 'OVERDUE'
  if (remaining <= DUE_SOON_WINDOW_MS) return 'DUE_SOON'
  return 'ON_TRACK'
}

/**
 * Flags that have blown their deadline and have not yet been escalated. The
 * escalation cron stamps escalatedAt, so a flag can only ever notify once —
 * the filter is what makes a retried cron run idempotent.
 */
export function flagsNeedingEscalation<T extends SlaFlag>(flags: T[], now: Date): T[] {
  return flags.filter(f => escalationState(f, now) === 'OVERDUE')
}
