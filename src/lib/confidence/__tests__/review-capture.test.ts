import { buildReviewLabels } from '../review-capture'
import { fieldInformation } from '@/lib/review/information-gain'

// Label capture. At document
// confirmation the reviewer's confirmed values are compared against what the model
// originally extracted, producing one GroundTruthLabel per AI-extracted field.
// This is the pure assembly step â no DB â that the confirm route persists
// best-effort.
//
// Crucially it captures *every* reviewed AI field, not just the numeric ones that
// become DataRecords: the #1 kill-signal field type (supplier identity) is a
// string field that never becomes a record, so its recordId is null.
//
// Each label also carries the field’s expected information gain and
// low-information verdict â the exact quantities the review UI ranked by â so the
// active-learning kill-signal (do ranked-high fields get corrected at a higher
// rate than random?) is measurable once reviewer traffic accumulates.

const base = {
  entityId: 'ent_1',
  documentId: 'doc_1',
  documentClass: 'ELECTRICITY_BILL',
}

describe('buildReviewLabels', () => {
  it('captures a string identity field with no record id as a confirmed label', () => {
    const labels = buildReviewLabels({
      ...base,
      extractedFields: [{ fieldName: 'supplier_name', rawValue: 'Acme Steel Ltd', confidenceScore: 0.7, admissibility: 'COMPULSORY', flagged: false }],
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
      extractedFields: [{ fieldName: 'total_consumption_kwh', rawValue: '100', confidenceScore: 0.9, admissibility: 'COMPULSORY', flagged: false }],
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

  it('skips confirmed fields the model never extracted (manual entry â no AI signal)', () => {
    const labels = buildReviewLabels({
      ...base,
      extractedFields: [{ fieldName: 'supplier_name', rawValue: 'Acme', confidenceScore: 0.8, admissibility: 'COMPULSORY', flagged: false }],
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
      extractedFields: [{ fieldName: 'supplier_name', rawValue: 'Acme', confidenceScore: 0.8, admissibility: 'COMPULSORY', flagged: false }],
      confirmedFields: [{ fieldName: 'supplier_name', confirmedValue: 'Acme', domain: 'ENERGY' }],
    })
    expect(labels[0].recordId).toBeNull()
  })

  it('records the fieldâs expected information gain, matched to the shared ranking helper', () => {
    const labels = buildReviewLabels({
      ...base,
      extractedFields: [{ fieldName: 'supplier_name', rawValue: 'Acme', confidenceScore: 0.7, admissibility: 'COMPULSORY', flagged: false }],
      confirmedFields: [{ fieldName: 'supplier_name', confirmedValue: 'Acme', domain: 'ENERGY' }],
    })
    const expected = fieldInformation({ fieldName: 'supplier_name', confidence: 0.7, admissibility: 'COMPULSORY', flagged: false, hasValue: true })
    expect(labels[0].expectedInformationGain).toBe(expected.gain)
    expect(labels[0].lowInformation).toBe(expected.lowInformation)
    expect(labels[0].lowInformation).toBe(false) // compulsory + uncertain â high info
  })

  it('marks a confident, unimportant, present, unflagged field low-information', () => {
    const labels = buildReviewLabels({
      ...base,
      extractedFields: [{ fieldName: 'notes', rawValue: 'x', confidenceScore: 0.999, admissibility: 'OPTIONAL', flagged: false }],
      confirmedFields: [{ fieldName: 'notes', confirmedValue: 'x', domain: 'ENERGY' }],
    })
    expect(labels[0].lowInformation).toBe(true)
  })

  it('treats a field the model found nothing for as not-low-information (missing stays prominent)', () => {
    const labels = buildReviewLabels({
      ...base,
      extractedFields: [{ fieldName: 'notes', rawValue: null, confidenceScore: 0.999, admissibility: 'OPTIONAL', flagged: false }],
      confirmedFields: [{ fieldName: 'notes', confirmedValue: 'filled in by hand', domain: 'ENERGY' }],
    })
    expect(labels[0].lowInformation).toBe(false)
  })

  it('stamps the extractor version on every label, so accuracy is sliceable by model/prompt', () => {
    const labels = buildReviewLabels({
      ...base,
      extractorVersion: 'claude-sonnet-4-6+v1',
      extractedFields: [
        { fieldName: 'supplier_name', rawValue: 'Acme', confidenceScore: 0.7, admissibility: 'COMPULSORY', flagged: false },
        { fieldName: 'total_consumption_kwh', rawValue: '100', confidenceScore: 0.9, admissibility: 'COMPULSORY', flagged: false },
      ],
      confirmedFields: [
        { fieldName: 'supplier_name', confirmedValue: 'Acme', domain: 'ENERGY' },
        { fieldName: 'total_consumption_kwh', confirmedValue: '100', domain: 'ENERGY' },
      ],
    })
    expect(labels).toHaveLength(2)
    expect(labels.every(l => l.extractorVersion === 'claude-sonnet-4-6+v1')).toBe(true)
  })

  it('defaults extractorVersion to null when the job has none (pre-stamping)', () => {
    const labels = buildReviewLabels({
      ...base,
      extractedFields: [{ fieldName: 'supplier_name', rawValue: 'Acme', confidenceScore: 0.8, admissibility: 'COMPULSORY', flagged: false }],
      confirmedFields: [{ fieldName: 'supplier_name', confirmedValue: 'Acme', domain: 'ENERGY' }],
    })
    expect(labels[0].extractorVersion).toBeNull()
  })
})
