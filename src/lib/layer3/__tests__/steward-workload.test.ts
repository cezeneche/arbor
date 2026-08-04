// Layer 3 — read-only. Counts and classifies flags that already exist; writes
// nothing and calculates no domain quantity. Answers the question stewardship
// exists to make answerable: who currently owes what, and where is the queue
// failing?

import { summariseStewardWorkload, type WorkloadFlag } from '../steward-workload'

const iso = (s: string) => new Date(s)
const NOW = iso('2026-08-06T00:00:00.000Z')

const flag = (over: Partial<WorkloadFlag> & Pick<WorkloadFlag, 'id'>): WorkloadFlag => ({
  severity: 'WARNING',
  assigneeId: 'user-1',
  assigneeName: 'Ada',
  domain: 'ENERGY',
  dueAt: iso('2026-08-20T00:00:00.000Z'),
  resolvedAt: null,
  escalatedAt: null,
  ...over,
})

describe('summariseStewardWorkload', () => {
  it('counts open flags per steward', () => {
    const got = summariseStewardWorkload(
      [flag({ id: 'a' }), flag({ id: 'b' }), flag({ id: 'c', assigneeId: 'user-2', assigneeName: 'Ben' })],
      NOW,
    )
    expect(got.find(r => r.assigneeId === 'user-1')?.open).toBe(2)
    expect(got.find(r => r.assigneeId === 'user-2')?.open).toBe(1)
  })

  it('counts overdue separately from open', () => {
    const got = summariseStewardWorkload(
      [flag({ id: 'a' }), flag({ id: 'late', dueAt: iso('2026-08-01T00:00:00.000Z') })],
      NOW,
    )
    const ada = got.find(r => r.assigneeId === 'user-1')!
    expect(ada.open).toBe(2)
    expect(ada.overdue).toBe(1)
  })

  it('excludes resolved flags from the open count', () => {
    const got = summariseStewardWorkload(
      [flag({ id: 'a' }), flag({ id: 'done', resolvedAt: iso('2026-08-02T00:00:00.000Z') })],
      NOW,
    )
    expect(got.find(r => r.assigneeId === 'user-1')?.open).toBe(1)
  })

  it('surfaces unowned flags as their own bucket instead of hiding them', () => {
    // The point of the whole feature: an unowned CRITICAL must be visible as
    // unowned, not absent from the summary.
    const got = summariseStewardWorkload(
      [flag({ id: 'orphan', assigneeId: null, assigneeName: null, severity: 'CRITICAL' })],
      NOW,
    )
    const unowned = got.find(r => r.assigneeId === null)!
    expect(unowned.assigneeName).toBe('Unassigned')
    expect(unowned.open).toBe(1)
    expect(unowned.critical).toBe(1)
  })

  it('sorts the worst queue first — overdue, then critical, then open', () => {
    const got = summariseStewardWorkload(
      [
        flag({ id: 'a', assigneeId: 'calm', assigneeName: 'Calm' }),
        flag({ id: 'b', assigneeId: 'calm', assigneeName: 'Calm' }),
        flag({ id: 'c', assigneeId: 'busy', assigneeName: 'Busy', dueAt: iso('2026-08-01T00:00:00.000Z') }),
      ],
      NOW,
    )
    expect(got[0].assigneeId).toBe('busy')
  })

  it('lists which domains a steward is carrying flags for', () => {
    const got = summariseStewardWorkload(
      [flag({ id: 'a', domain: 'ENERGY' }), flag({ id: 'b', domain: 'LOGISTICS' })],
      NOW,
    )
    expect(got[0].domains.sort()).toEqual(['ENERGY', 'LOGISTICS'])
  })

  it('returns an empty summary for no flags rather than a zero row', () => {
    expect(summariseStewardWorkload([], NOW)).toEqual([])
  })
})
