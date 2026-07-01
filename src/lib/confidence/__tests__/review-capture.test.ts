import { buildReviewLabels } from '../review-capture'

// Label capture (Upgrade 1, minimal slice). At document confirmation the
// reviewer's confirmed values are compared against what the model originally
// extracted, producing one GroundTruthLabel per AI-extracted field. This is the
// pure assembly step — no DB — that the confirm route persists best-effort.
//
// Crucially it captures *every* reviewed AI field, not just the numeric ones
// that become DataRecords: the #1 kill-signal field type (supplier identity) is
// a string field that never becomes a record, so its recordId is null.

const base = {
  entityId: 'ent_1',
  documentId: 'doc_1',
  documentClass: 'ELECTRICITY_BILL',
}

describe('buildReviewLabels', () => {
  it('captures a string identity field with no record id as a confirmed label', () => {
    const labels = buildReviewLabels({
      ...base,
      extractedFields: [{ fieldName: 'supplier_name', rawValue: 'Acme Steel Ltd', confidenceScore: 0.7 }],
      confirmedFields: [{ fieldName: 'supplier_name', confirmedValue: 'Acme Steel Ltd', domain: 'ENERGY' }],
    })
    expect(labels).toHaveLength(1)
    expect(labels[0]).toMatchObject({
      fieldName: 'supplier_name',
      documentClass: 'ELECTRICITY_BILL',
      wasCorrect: true,
      source: 'REVIEW_CONFIRMED',
      confidenceAtExtraction: 0.7,
      recordId: null,
    })
  })

  it('uses the model score at extraction, and attaches the written record id for numeric fields', () => {
    const labels = buildReviewLabels({
      ...base,
      extractedFields: [{ fieldName: 'total_consumption_kwh', rawValue: '100', confidenceScore: 0.9 }],
      confirmedFields: [{ fieldName: 'total_consumption_kwh', confirmedValue: '250', domain: 'ENERGY' }],
      recordIdByField: { total_consumption_kwh: 'rec_1' },
    })
    expect(labels[0]).toMatchObject({
      wasCorrect: false, // 100 -> 250 is a genuine correction
      source: 'REVIEW_CORRECTED',
      confidenceAtExtraction: 0.9,
      recordId: 'rec_1',
    })
  })

  it('skips confirmed fields the model never extracted (manual entry — no AI signal)', () => {
    const labels = buildReviewLabels({
      ...base,
      extractedFields: [{ fieldName: 'supplier_name', rawValue: 'Acme', confidenceScore: 0.8 }],
      confirmedFields: [
        { fieldName: 'supplier_name', confirmedValue: 'Acme', domain: 'ENERGY' },
        { fieldName: 'meter_reference', confirmedValue: 'MPAN-123', domain: 'ENERGY' },
      ],
    })
    expect(labels.map(l => l.fieldName)).toEqual(['supplier_name'])
  })

  it('defaults recordId to null when no record-id map is supplied', () => {
    const labels = buildReviewLabels({
      ...base,
      extractedFields: [{ fieldName: 'supplier_name', rawValue: 'Acme', confidenceScore: 0.8 }],
      confirmedFields: [{ fieldName: 'supplier_name', confirmedValue: 'Acme', domain: 'ENERGY' }],
    })
    expect(labels[0].recordId).toBeNull()
  })
})
