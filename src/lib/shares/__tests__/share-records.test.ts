import { shareRecordWhere } from '../share-records'

// A share is a frozen submission: the records it was issued with, which its
// integrity hash covers. Correcting a figure afterwards supersedes the record
// rather than editing it, so the issued record is still there to show — marked
// as corrected — and the hash still matches what the recipient sees.
describe('shareRecordWhere', () => {
  const base = { entityId: 'ent-1', domain: null, periodStart: null, periodEnd: null }

  it('reads exactly the issued records, active or since corrected', () => {
    expect(shareRecordWhere({ ...base, recordIds: ['r1', 'r2'] })).toEqual({
      entityId: 'ent-1',
      id: { in: ['r1', 'r2'] },
    })
  })

  it('reads the live scope for a share issued before snapshots existed', () => {
    const periodStart = new Date('2026-01-01')
    expect(shareRecordWhere({ ...base, domain: 'ENERGY', periodStart, recordIds: [] })).toEqual({
      entityId: 'ent-1',
      isActive: true,
      domain: 'ENERGY',
      periodStart: { gte: periodStart },
    })
  })
})
