// Proportionate control, matching the judgement already made in the auto-accept
// physics gate: a CRITICAL finding gets a short clock, a WARNING gets a long one,
// and an INFO note gets none at all. An SLA on every flag would flood a five-person
// steel stockholder's office manager and the whole thing would be ignored — which
// is worse than no SLA, because it looks like a control while being none.
//
// Pure policy. No DB, no clock of its own — `now` is always injected.

import {
  dueDateFor,
  escalationState,
  flagsNeedingEscalation,
  SLA_WINDOW_DAYS,
  type SlaFlag,
} from '../sla'

const iso = (s: string) => new Date(s)
const ASSIGNED = iso('2026-08-01T00:00:00.000Z')

const day = 24 * 60 * 60 * 1000

describe('dueDateFor', () => {
  it('gives a CRITICAL flag three days', () => {
    expect(dueDateFor('CRITICAL', ASSIGNED)).toEqual(new Date(ASSIGNED.getTime() + 3 * day))
  })

  it('gives a WARNING fourteen days', () => {
    expect(dueDateFor('WARNING', ASSIGNED)).toEqual(new Date(ASSIGNED.getTime() + 14 * day))
  })

  it('gives an INFO note no deadline at all', () => {
    // Deliberate. INFO exists to inform, not to create work.
    expect(dueDateFor('INFO', ASSIGNED)).toBeNull()
  })

  it('exposes the windows as a single tunable knob', () => {
    expect(SLA_WINDOW_DAYS).toEqual({ CRITICAL: 3, WARNING: 14, INFO: null })
  })
})

describe('escalationState', () => {
  const critical: SlaFlag = {
    id: 'flag-1',
    severity: 'CRITICAL',
    assigneeId: 'user-1',
    dueAt: iso('2026-08-04T00:00:00.000Z'),
    resolvedAt: null,
    escalatedAt: null,
  }

  it('reports RESOLVED once the steward has closed it, whatever the clock says', () => {
    const got = escalationState({ ...critical, resolvedAt: iso('2026-08-02T00:00:00.000Z') },
      iso('2026-09-01T00:00:00.000Z'))
    expect(got).toBe('RESOLVED')
  })

  it('reports NO_SLA for a flag with no deadline', () => {
    const got = escalationState({ ...critical, severity: 'INFO', dueAt: null },
      iso('2026-09-01T00:00:00.000Z'))
    expect(got).toBe('NO_SLA')
  })

  it('reports ON_TRACK while there is more than a day left', () => {
    expect(escalationState(critical, iso('2026-08-01T12:00:00.000Z'))).toBe('ON_TRACK')
  })

  it('reports DUE_SOON inside the final 24 hours', () => {
    expect(escalationState(critical, iso('2026-08-03T06:00:00.000Z'))).toBe('DUE_SOON')
  })

  it('reports OVERDUE once the deadline passes', () => {
    expect(escalationState(critical, iso('2026-08-05T00:00:00.000Z'))).toBe('OVERDUE')
  })

  it('reports ESCALATED once it has been raised to the entity admin', () => {
    const got = escalationState({ ...critical, escalatedAt: iso('2026-08-05T00:00:00.000Z') },
      iso('2026-08-06T00:00:00.000Z'))
    expect(got).toBe('ESCALATED')
  })

  it('reports OVERDUE for an unowned flag that has blown its deadline', () => {
    // No assignee is exactly the condition worth surfacing loudest.
    const orphan: SlaFlag = { ...critical, assigneeId: null }
    expect(escalationState(orphan, iso('2026-08-05T00:00:00.000Z'))).toBe('OVERDUE')
  })
})

describe('flagsNeedingEscalation', () => {
  const base: SlaFlag = {
    id: 'f',
    severity: 'CRITICAL',
    assigneeId: 'user-1',
    dueAt: iso('2026-08-04T00:00:00.000Z'),
    resolvedAt: null,
    escalatedAt: null,
  }
  const now = iso('2026-08-06T00:00:00.000Z')

  it('selects overdue, unresolved, not-yet-escalated flags', () => {
    const got = flagsNeedingEscalation([{ ...base, id: 'overdue' }], now)
    expect(got.map(f => f.id)).toEqual(['overdue'])
  })

  it('excludes flags already escalated so the cron cannot notify twice', () => {
    const got = flagsNeedingEscalation(
      [{ ...base, id: 'already', escalatedAt: iso('2026-08-05T00:00:00.000Z') }], now)
    expect(got).toHaveLength(0)
  })

  it('excludes resolved flags', () => {
    const got = flagsNeedingEscalation(
      [{ ...base, id: 'done', resolvedAt: iso('2026-08-03T00:00:00.000Z') }], now)
    expect(got).toHaveLength(0)
  })

  it('excludes flags still inside their window', () => {
    const got = flagsNeedingEscalation([{ ...base, id: 'ontrack' }], iso('2026-08-02T00:00:00.000Z'))
    expect(got).toHaveLength(0)
  })

  it('excludes INFO flags, which carry no deadline to miss', () => {
    const got = flagsNeedingEscalation([{ ...base, id: 'info', severity: 'INFO', dueAt: null }], now)
    expect(got).toHaveLength(0)
  })
})
