import { buildGroundTruthLabel, valuesMatch } from '../ground-truth'

// Upgrade 1 — calibration training signal.
//
// Every human review decision is a labelled datapoint: the model's confidence
// at extraction time paired with whether its extracted value was actually
// correct (i.e. survived review unchanged). POST /calibration/fit consumes a
// stream of these to fit the calibration map and compute ECE / Brier /
// reliability curves. `buildGroundTruthLabel` is the pure mapping from a single
// field's review decision to the row we persist — no DB, no side effects.

describe('valuesMatch — did the extracted value survive review', () => {
  it('treats trimmed / case / whitespace differences as a match', () => {
    // Reason: the model was right about the supplier; cosmetic normalisation by
    // the reviewer is not a correction.
    expect(valuesMatch('Acme Steel Ltd', '  acme   steel ltd ')).toBe(true)
  })

  it('compares numeric values numerically, not as strings', () => {
    // Reason: "100" and "100.0" are the same mass reading — not a correction.
    expect(valuesMatch('100', '100.0')).toBe(true)
    expect(valuesMatch('1000', '1,000')).toBe(true)
  })

  it('flags a genuine value change as a non-match', () => {
    expect(valuesMatch('100', '200')).toBe(false)
    expect(valuesMatch('Acme Steel Ltd', 'Acme Aluminium Ltd')).toBe(false)
  })

  it('both-empty counts as a match (model correctly found nothing)', () => {
    expect(valuesMatch(null, null)).toBe(true)
    expect(valuesMatch(null, '   ')).toBe(true)
  })

  it('extracted-null but confirmed-present is a non-match', () => {
    expect(valuesMatch(null, 'Acme Steel Ltd')).toBe(false)
  })
})

describe('buildGroundTruthLabel', () => {
  const base = {
    entityId: 'ent_1',
    documentId: 'doc_1',
    recordId: 'rec_1',
    fieldName: 'supplier_name',
    documentClass: 'ELECTRICITY_BILL',
    domain: 'ENERGY',
    confidenceAtExtraction: 0.72,
  }

  it('labels an unchanged confirmation as correct → REVIEW_CONFIRMED', () => {
    const label = buildGroundTruthLabel({
      ...base,
      extractedValue: 'Acme Steel Ltd',
      confirmedValue: 'Acme Steel Ltd',
    })
    expect(label.wasCorrect).toBe(true)
    expect(label.source).toBe('REVIEW_CONFIRMED')
    expect(label.confidenceAtExtraction).toBe(0.72)
    expect(label.fieldName).toBe('supplier_name')
    expect(label.documentClass).toBe('ELECTRICITY_BILL')
    expect(label.domain).toBe('ENERGY')
  })

  it('labels a corrected value as incorrect → REVIEW_CORRECTED', () => {
    // Reason: the human changed the value — the model was wrong, and this is the
    // most valuable calibration signal (a high-confidence miss).
    const label = buildGroundTruthLabel({
      ...base,
      extractedValue: '100',
      confirmedValue: '250',
    })
    expect(label.wasCorrect).toBe(false)
    expect(label.source).toBe('REVIEW_CORRECTED')
    expect(label.extractedValue).toBe('100')
    expect(label.confirmedValue).toBe('250')
  })

  it('preserves nullable documentId/recordId for corrected-and-discarded fields', () => {
    // Reason: a field the model hallucinated may be corrected before any
    // DataRecord is written — the label still counts as a miss.
    const label = buildGroundTruthLabel({
      ...base,
      documentId: null,
      recordId: null,
      extractedValue: 'ghost value',
      confirmedValue: null,
    })
    expect(label.documentId).toBeNull()
    expect(label.recordId).toBeNull()
    expect(label.wasCorrect).toBe(false)
  })

  it('clamps confidence into [0,1] so a stray score cannot poison the fit', () => {
    expect(
      buildGroundTruthLabel({ ...base, extractedValue: 'x', confirmedValue: 'x', confidenceAtExtraction: 1.4 })
        .confidenceAtExtraction,
    ).toBe(1)
    expect(
      buildGroundTruthLabel({ ...base, extractedValue: 'x', confirmedValue: 'x', confidenceAtExtraction: -0.2 })
        .confidenceAtExtraction,
    ).toBe(0)
  })
})
