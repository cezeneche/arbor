import { latestStatements, presentVerification, type StatementSummary } from '../verification-presenter'

// A supplier's emissions figure goes on a return as actual, verified data only
// once an accredited verifier's statement has been accepted. Nucleos holds the
// status; Arbor holds the statement. This decides what the goods line says and
// which action it offers — never more than one at a time.

const statement = (over: Partial<StatementSummary> = {}): StatementSummary => ({
  id: 'stmt-1',
  status: 'SUBMITTED',
  verifierName: 'Carbon Assurance Ltd',
  verifierAccreditation: 'UKAS 9876',
  uploadedByName: 'Ada Lovelace',
  uploadedAt: '2027-03-20T10:00:00.000Z',
  decidedByName: null,
  rejectionReason: null,
  syncedToNucleos: true,
  ...over,
})

describe('presentVerification', () => {
  it('offers nothing for a line on the published default', () => {
    const v = presentVerification({ method: 'default', status: 'not_required' }, null)
    expect(v.applicable).toBe(false)
  })

  it('offers nothing for a line with no emissions figure yet', () => {
    expect(presentVerification({ method: null, status: 'not_required' }, null).applicable).toBe(false)
  })

  it('invites a statement for an unverified supplier figure', () => {
    const v = presentVerification({ method: 'actual', status: 'not_required' }, null)
    expect(v).toMatchObject({ applicable: true, state: 'unverified', action: 'upload' })
    expect(v.label).toMatch(/not verified/i)
  })

  it('asks for a decision once a statement has been received', () => {
    const v = presentVerification({ method: 'actual', status: 'submitted' }, statement())
    expect(v).toMatchObject({ state: 'received', action: 'decide', statementId: 'stmt-1' })
    expect(v.detail).toContain('Carbon Assurance Ltd')
  })

  it('names the verifier once accepted, and offers nothing further', () => {
    const v = presentVerification(
      {
        method: 'actual',
        status: 'verified',
        verifierName: 'Carbon Assurance Ltd',
        verifierAccreditation: 'UKAS 9876',
      },
      statement({ status: 'ACCEPTED', decidedByName: 'Grace Hopper' }),
    )
    expect(v).toMatchObject({ state: 'verified', action: null })
    expect(v.label).toBe('Verified by Carbon Assurance Ltd (UKAS 9876)')
  })

  it('gives the reason for a rejection and invites another statement', () => {
    const v = presentVerification(
      { method: 'actual', status: 'rejected' },
      statement({ status: 'REJECTED', rejectionReason: 'Covers the wrong installation.' }),
    )
    expect(v).toMatchObject({ state: 'rejected', action: 'upload' })
    expect(v.detail).toContain('Covers the wrong installation.')
  })

  // The file is safe in Arbor but Nucleos was not told. Retrying is the only
  // useful action; accepting a statement Nucleos has not recorded would fail.
  it('offers a retry when the statement has not reached the case yet', () => {
    const v = presentVerification(
      { method: 'actual', status: 'not_required' },
      statement({ syncedToNucleos: false }),
    )
    expect(v).toMatchObject({ state: 'unsynced', action: 'retry', statementId: 'stmt-1' })
  })

  it('treats an estimated supplier figure like an actual one', () => {
    expect(presentVerification({ method: 'estimated', status: 'not_required' }, null).applicable).toBe(true)
  })
})

describe('latestStatements', () => {
  const row = (over: Partial<Parameters<typeof latestStatements>[0][number]> = {}) => ({
    id: 'stmt-1',
    goodsLineId: 'gl-1',
    status: 'SUBMITTED' as const,
    verifierName: 'Carbon Assurance Ltd',
    verifierAccreditation: 'UKAS 9876',
    uploadedById: 'user-1',
    uploadedAt: new Date('2027-03-20T10:00:00Z'),
    decidedById: null,
    rejectionReason: null,
    syncedAt: new Date('2027-03-20T10:00:01Z'),
    ...over,
  })

  it('keeps the newest statement for each goods line, with names', () => {
    const out = latestStatements(
      [
        row({ id: 'old', status: 'REJECTED', uploadedAt: new Date('2027-03-01T00:00:00Z') }),
        row({ id: 'new' }),
        row({ id: 'other', goodsLineId: 'gl-2', decidedById: 'user-2', status: 'ACCEPTED' }),
      ],
      new Map([
        ['user-1', 'Ada Lovelace'],
        ['user-2', 'Grace Hopper'],
      ]),
    )
    expect(out.get('gl-1')).toMatchObject({
      id: 'new',
      uploadedByName: 'Ada Lovelace',
      syncedToNucleos: true,
    })
    expect(out.get('gl-2')).toMatchObject({ id: 'other', decidedByName: 'Grace Hopper' })
  })

  it('marks a statement Nucleos has not recorded', () => {
    expect(latestStatements([row({ syncedAt: null })], new Map()).get('gl-1')?.syncedToNucleos).toBe(false)
  })
})
