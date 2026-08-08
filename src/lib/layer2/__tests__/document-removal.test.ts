// Layer 2 — what "delete this document" can honestly mean, given its state.
//
// Before anything is saved a document is just a file and an extraction, and
// deleting it removes both. Once it has become records the word cannot mean
// that: those records are links in the entity's HMAC audit chain, and the chain
// is append-only (PRD §20.3). Removing a link would break every hash after it,
// which is the one thing a certified repository must never do.
//
// So a saved document is withdrawn instead: its records leave the active set,
// so they stop appearing in records, totals, coverage and exports — everywhere
// the user looks — and the chain gains an entry saying they were withdrawn,
// by whom and when. Nothing is erased and nothing is rewritten.

process.env.AUDIT_CHAIN_SECRET = 'test-secret-for-document-removal'

import {
  planDocumentRemoval,
  buildWithdrawalPayload,
  type WithdrawableRecord,
} from '../document-removal'

const record = (over: Partial<WithdrawableRecord> = {}): WithdrawableRecord => ({
  id: 'rec_1',
  entityId: 'ent_1',
  domain: 'LOGISTICS',
  fieldName: 'declared_weight',
  value: 24500,
  unit: 'kg',
  originalValue: 24500,
  originalUnit: 'kg',
  periodStart: new Date('2026-06-01T00:00:00.000Z'),
  periodEnd: new Date('2026-06-30T00:00:00.000Z'),
  trustTier: 'A',
  confidenceScore: 0.97,
  sourceText: 'Gross mass 24 500 KG',
  documentId: 'doc_1',
  extractionMethod: 'DOCUMENT_AI',
  ...over,
})

describe('planDocumentRemoval', () => {
  it('deletes a document that never became records', () => {
    expect(planDocumentRemoval({ status: 'REVIEW_REQUIRED', records: [] }).mode).toBe('HARD_DELETE')
  })

  it('deletes a document whose extraction failed', () => {
    expect(planDocumentRemoval({ status: 'REJECTED', records: [] }).mode).toBe('HARD_DELETE')
  })

  it('withdraws a document that has records rather than deleting it', () => {
    // The records are in the audit chain. Deleting them would break it.
    expect(planDocumentRemoval({ status: 'ACCEPTED', records: [record()] }).mode).toBe('WITHDRAW')
  })

  it('withdraws an accepted document even if it somehow holds no records', () => {
    // Acceptance is the point of no return, whatever the record table says now.
    expect(planDocumentRemoval({ status: 'ACCEPTED', records: [] }).mode).toBe('WITHDRAW')
  })

  it('withdraws records attached to a document that was never marked accepted', () => {
    // Status and records disagreeing is not a reason to delete certified rows.
    expect(planDocumentRemoval({ status: 'REVIEW_REQUIRED', records: [record()] }).mode).toBe('WITHDRAW')
  })

  it('names every record it would withdraw', () => {
    const plan = planDocumentRemoval({
      status: 'ACCEPTED',
      records: [record({ id: 'a' }), record({ id: 'b' })],
    })
    expect(plan.recordIds).toEqual(['a', 'b'])
  })

  it('has nothing to withdraw when it is deleting', () => {
    expect(planDocumentRemoval({ status: 'PENDING', records: [] }).recordIds).toEqual([])
  })
})

describe('buildWithdrawalPayload', () => {
  const at = new Date('2026-08-08T09:00:00.000Z')

  it('states which record left the active set', () => {
    const payload = buildWithdrawalPayload(record({ id: 'rec_9' }), { at, byId: 'usr_2' })
    expect(payload.recordId).toBe('rec_9')
    expect(payload.entityId).toBe('ent_1')
  })

  it('echoes the figure that was withdrawn, so the entry says what was removed', () => {
    const payload = buildWithdrawalPayload(record(), { at, byId: 'usr_2' })
    expect(payload.value).toBe(24500)
    expect(payload.unit).toBe('kg')
    expect(payload.fieldName).toBe('declared_weight')
    expect(payload.trustTier).toBe('A')
  })

  it('records who withdrew it and when — not who submitted it', () => {
    const payload = buildWithdrawalPayload(record(), { at, byId: 'usr_2' })
    expect(payload.submittedById).toBe('usr_2')
    expect(payload.submittedAt).toBe('2026-08-08T09:00:00.000Z')
  })

  it('falls back to the stored figure when the record kept no pre-normalisation value', () => {
    // originalValue/originalUnit are nullable on the row; the audit payload is not.
    const payload = buildWithdrawalPayload(
      record({ originalValue: null, originalUnit: null }),
      { at, byId: 'usr_2' },
    )
    expect(payload.originalValue).toBe(24500)
    expect(payload.originalUnit).toBe('kg')
  })

  it('serialises the period as the chain stores it', () => {
    const payload = buildWithdrawalPayload(record(), { at, byId: 'usr_2' })
    expect(payload.periodStart).toBe('2026-06-01T00:00:00.000Z')
    expect(payload.periodEnd).toBe('2026-06-30T00:00:00.000Z')
  })

  it('distinguishes two withdrawals of different records', () => {
    const a = buildWithdrawalPayload(record({ id: 'a' }), { at, byId: 'usr_2' })
    const b = buildWithdrawalPayload(record({ id: 'b' }), { at, byId: 'usr_2' })
    expect(a.recordId).not.toBe(b.recordId)
  })

  it('produces a payload the audit chain can hash', () => {
    // It has to be a real AuditPayload: the withdrawal is a link like any other.
    const { computeRecordHash } = jest.requireActual('../audit-chain')
    const payload = buildWithdrawalPayload(record(), { at, byId: 'usr_2' })
    expect(computeRecordHash(payload, 'prev')).toMatch(/^[0-9a-f]{64}$/)
  })
})
