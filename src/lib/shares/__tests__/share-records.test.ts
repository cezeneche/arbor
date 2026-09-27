import { isFrozenShare, shareRecordWhere } from '../share-records'

// A share is a frozen submission: the records it was issued with, which its
// integrity hash covers. Correcting a figure afterwards supersedes the record
// rather than editing it, so the issued record is still there to show — marked
// as corrected — and the hash still matches what the recipient sees.
describe('shareRecordWhere', () => {
  const base = { entityId: 'ent-1', domain: null, periodStart: null, periodEnd: null }

  it('reads exactly the issued records, active or since corrected', () => {
    expect(shareRecordWhere({ ...base, isSnapshot: true, recordIds: ['r1', 'r2'] })).toEqual({
      entityId: 'ent-1',
      id: { in: ['r1', 'r2'] },
    })
  })

  it('reads the live scope for a share issued before snapshots existed', () => {
    const periodStart = new Date('2026-01-01')
    expect(
      shareRecordWhere({ ...base, isSnapshot: false, domain: 'ENERGY', periodStart, recordIds: [] }),
    ).toEqual({
      entityId: 'ent-1',
      isActive: true,
      domain: 'ENERGY',
      periodStart: { gte: periodStart },
    })
  })

  // An empty record list used to mean "legacy, live scope". A share issued over
  // a scope with nothing in it froze an empty list, was read as legacy, and began
  // showing every record added to that scope afterwards — through a public link
  // whose integrity hash covered nothing.
  it('shows nothing for a snapshot issued over an empty scope', () => {
    const where = shareRecordWhere({ ...base, isSnapshot: true, recordIds: [] })
    expect(where).toEqual({ entityId: 'ent-1', id: { in: [] } })
    expect(where).not.toHaveProperty('isActive')
  })

  it('treats an empty snapshot as frozen', () => {
    expect(isFrozenShare({ isSnapshot: true, recordIds: [] })).toBe(true)
    expect(isFrozenShare({ isSnapshot: false, recordIds: [] })).toBe(false)
  })
})
