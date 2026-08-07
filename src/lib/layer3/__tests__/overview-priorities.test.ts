// Layer 3 — the "needs you now" band at the top of the Overview.
//
// Everything here is something the ops manager can act on from this screen
// today. Anything they cannot act on belongs further down the page, or not on
// it at all.

import { buildOverviewPriorities, type PriorityInput } from '../overview-priorities'

const input = (over: Partial<PriorityInput> = {}): PriorityInput => ({
  valuesAwaitingCheck: 0,
  documentsAwaitingCheck: 0,
  criticalFlags: 0,
  failedDocuments: 0,
  ...over,
})

describe('buildOverviewPriorities', () => {
  it('shows nothing when nothing needs doing', () => {
    expect(buildOverviewPriorities(input())).toEqual([])
  })

  it('raises unconfirmed values, because until they are checked they are not records at all', () => {
    const [item] = buildOverviewPriorities(input({ valuesAwaitingCheck: 7, documentsAwaitingCheck: 2 }))
    expect(item.text).toContain('7')
    expect(item.text).toContain('2')
    expect(item.href).toBe('/review')
  })

  it('raises a document that failed to process', () => {
    const [item] = buildOverviewPriorities(input({ failedDocuments: 1 }))
    expect(item.href).toBe('/upload')
    expect(item.severity).toBe('critical')
  })

  it('raises records carrying a critical flag', () => {
    const [item] = buildOverviewPriorities(input({ criticalFlags: 3 }))
    expect(item.text).toContain('3')
    expect(item.href).toBe('/records')
    expect(item.severity).toBe('critical')
  })

  it('puts what is already broken above what is merely waiting', () => {
    const items = buildOverviewPriorities(input({
      valuesAwaitingCheck: 5, documentsAwaitingCheck: 1, criticalFlags: 2, failedDocuments: 1,
    }))
    expect(items.map(i => i.href)).toEqual(['/upload', '/records', '/review'])
  })

  it('reads as plain English with no internal vocabulary', () => {
    const items = buildOverviewPriorities(input({
      valuesAwaitingCheck: 4, documentsAwaitingCheck: 1, criticalFlags: 1, failedDocuments: 1,
    }))
    for (const item of items) {
      expect(item.text).not.toMatch(/tier|domain|REVIEW_REQUIRED|extraction|admissibility/i)
      expect(item.actionLabel).toBeTruthy()
    }
  })

  it('gets singular and plural right', () => {
    const one = buildOverviewPriorities(input({ valuesAwaitingCheck: 1, documentsAwaitingCheck: 1 }))[0]
    expect(one.text).toMatch(/1 value/)
    expect(one.text).not.toMatch(/1 values/)

    const many = buildOverviewPriorities(input({ valuesAwaitingCheck: 3, documentsAwaitingCheck: 2 }))[0]
    expect(many.text).toMatch(/3 values/)
    expect(many.text).toMatch(/2 documents/)
  })

  it('gives every item a stable key', () => {
    const items = buildOverviewPriorities(input({ valuesAwaitingCheck: 1, criticalFlags: 1, failedDocuments: 1 }))
    expect(new Set(items.map(i => i.key)).size).toBe(items.length)
  })
})
