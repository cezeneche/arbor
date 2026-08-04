// Layer 3 — read-only. Counts and classifies flags that already exist in the
// store. Writes nothing, converts nothing, calculates no domain quantity.
//
// Answers the question stewardship exists to make answerable: who currently owes
// what, and where is the queue failing? Unowned flags get their own row rather
// than being omitted — the whole point is that "nobody's job" becomes visible.

import { escalationState, type FlagSeverity, type SlaFlag } from '@/lib/stewardship/sla'
import type { DataDomain } from '@/lib/constants'

export interface WorkloadFlag extends SlaFlag {
  assigneeName: string | null
  domain: DataDomain
}

export interface StewardWorkload {
  assigneeId: string | null
  assigneeName: string
  open: number
  overdue: number
  critical: number
  domains: DataDomain[]
}

const UNASSIGNED_LABEL = 'Unassigned'

/**
 * Open-flag counts per owner, worst queue first. "Open" excludes resolved flags;
 * "overdue" counts those past their deadline, escalated or not.
 */
export function summariseStewardWorkload(
  flags: WorkloadFlag[],
  now: Date,
): StewardWorkload[] {
  const byOwner = new Map<string, StewardWorkload & { domainSet: Set<DataDomain> }>()

  for (const flag of flags) {
    const state = escalationState(flag, now)
    if (state === 'RESOLVED') continue

    const key = flag.assigneeId ?? ''
    let row = byOwner.get(key)
    if (!row) {
      row = {
        assigneeId: flag.assigneeId,
        assigneeName: flag.assigneeName ?? UNASSIGNED_LABEL,
        open: 0,
        overdue: 0,
        critical: 0,
        domains: [],
        domainSet: new Set<DataDomain>(),
      }
      byOwner.set(key, row)
    }

    row.open += 1
    if (state === 'OVERDUE' || state === 'ESCALATED') row.overdue += 1
    if (flag.severity === ('CRITICAL' satisfies FlagSeverity)) row.critical += 1
    row.domainSet.add(flag.domain)
  }

  return [...byOwner.values()]
    .map(({ domainSet, ...row }) => ({ ...row, domains: [...domainSet] }))
    .sort(
      (a, b) =>
        b.overdue - a.overdue ||
        b.critical - a.critical ||
        b.open - a.open ||
        a.assigneeName.localeCompare(b.assigneeName),
    )
}
