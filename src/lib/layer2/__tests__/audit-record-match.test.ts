import { auditPayloadMismatches, type StoredRecordFields } from '../audit-record-match'
import type { AuditPayload } from '../audit-chain'

// The verify endpoint compares each chain entry against the live record it
// names. A creation entry attests to the whole record, including who submitted
// it. A withdrawal entry echoes the record but is signed by whoever withdrew it
// — so comparing its actor against the original submitter reported every
// withdrawal by a colleague as tampering.

const record: StoredRecordFields = {
  domain: 'ENERGY',
  fieldName: 'total_consumption_kwh',
  value: 44640,
  unit: 'MJ',
  originalValue: 12400,
  originalUnit: 'kWh',
  periodStart: new Date('2026-01-01T00:00:00.000Z'),
  periodEnd: new Date('2026-03-31T23:59:59.999Z'),
  trustTier: 'A',
  confidenceScore: 0.97,
  sourceText: 'Total units 12,400 kWh',
  documentId: 'doc_1',
  extractionMethod: 'DOCUMENT_AI',
  submittedById: 'usr_alice',
}

const payload = (over: Partial<AuditPayload> = {}): AuditPayload => ({
  recordId: 'rec_1',
  entityId: 'ent_1',
  domain: 'ENERGY',
  fieldName: 'total_consumption_kwh',
  value: 44640,
  unit: 'MJ',
  originalValue: 12400,
  originalUnit: 'kWh',
  periodStart: '2026-01-01T00:00:00.000Z',
  periodEnd: '2026-03-31T23:59:59.999Z',
  trustTier: 'A',
  confidenceScore: 0.97,
  sourceText: 'Total units 12,400 kWh',
  documentId: 'doc_1',
  extractionMethod: 'DOCUMENT_AI',
  submittedAt: '2026-04-02T09:00:00.000Z',
  submittedById: 'usr_alice',
  ...over,
})

describe('auditPayloadMismatches', () => {
  it('finds nothing when a creation entry matches its record', () => {
    expect(auditPayloadMismatches('CREATED', payload(), record)).toEqual([])
  })

  it('reports a creation entry whose submitter differs from the record', () => {
    expect(auditPayloadMismatches('CREATED', payload({ submittedById: 'usr_mallory' }), record)).toEqual([
      'submittedById',
    ])
  })

  it('accepts a withdrawal made by a colleague', () => {
    expect(
      auditPayloadMismatches(
        'WITHDRAWN',
        payload({ submittedById: 'usr_bob', submittedAt: '2026-05-01T10:00:00.000Z' }),
        record,
      ),
    ).toEqual([])
  })

  it('still catches a record altered after it was withdrawn', () => {
    expect(
      auditPayloadMismatches('WITHDRAWN', payload({ submittedById: 'usr_bob' }), { ...record, value: 1 }),
    ).toEqual(['value'])
  })

  it('reads a record with no pre-normalisation figure as the withdrawal payload does', () => {
    const bare = { ...record, originalValue: null, originalUnit: null }
    expect(
      auditPayloadMismatches(
        'WITHDRAWN',
        payload({ originalValue: 44640, originalUnit: 'MJ', submittedById: 'usr_bob' }),
        bare,
      ),
    ).toEqual([])
  })
})
