import {
  buildExemplarHints,
  renderCorrectionHints,
  MAX_EXEMPLAR_FIELDS,
  type CorrectionLabel,
} from '../correction-exemplars'

// Relearning extractor — correction exemplars (pure; no DB, no AI).
// Turns a tenant's own past review CORRECTIONS on a document type into compact
// attention hints for the extraction prompt: which fields are error-prone, and
// whether the model tends to mis-read them or over-extract them. Deliberately
// carries NO past values into the prompt — this is certified data, and a stale
// value copied into a new document would be a wrong certified fact. Hints focus
// attention; they never supply answers.

const corr = (fieldName: string, extracted: string | null, confirmed: string | null): CorrectionLabel => ({
  fieldName,
  extractedValue: extracted,
  confirmedValue: confirmed,
})

describe('buildExemplarHints', () => {
  it('counts corrections per field and ranks the most-corrected first', () => {
    const hints = buildExemplarHints([
      corr('declared_weight', '1000', '100'),
      corr('declared_weight', '50', '5'),
      corr('supplier_name', 'Acme', 'Acme Steel'),
    ])
    expect(hints[0].fieldName).toBe('declared_weight')
    expect(hints[0].timesCorrected).toBe(2)
    expect(hints[1].fieldName).toBe('supplier_name')
  })

  it('classifies a non-null correction as a mis-read and a cleared value as over-extraction', () => {
    const hints = buildExemplarHints([
      corr('declared_weight', '1000', '100'), // wrong value -> mis-read
      corr('vat_number', 'GB123', null), // reviewer removed it -> over-extracted
    ])
    const weight = hints.find(h => h.fieldName === 'declared_weight')!
    const vat = hints.find(h => h.fieldName === 'vat_number')!
    expect(weight.misreadCount).toBe(1)
    expect(weight.clearedCount).toBe(0)
    expect(vat.clearedCount).toBe(1)
    expect(vat.misreadCount).toBe(0)
  })

  it('ignores labels with no signal (both values null)', () => {
    expect(buildExemplarHints([corr('x', null, null)])).toEqual([])
  })

  it('caps the number of fields to keep the prompt bounded', () => {
    const labels: CorrectionLabel[] = []
    for (let i = 0; i < MAX_EXEMPLAR_FIELDS + 3; i++) labels.push(corr(`field_${i}`, 'a', 'b'))
    expect(buildExemplarHints(labels).length).toBe(MAX_EXEMPLAR_FIELDS)
  })

  it('is deterministic for equal counts (tie-break by field name)', () => {
    const a = buildExemplarHints([corr('b_field', 'x', 'y'), corr('a_field', 'x', 'y')])
    expect(a.map(h => h.fieldName)).toEqual(['a_field', 'b_field'])
  })
})

describe('renderCorrectionHints', () => {
  it('returns an empty string when there are no hints (prompt unchanged)', () => {
    expect(renderCorrectionHints([])).toBe('')
  })

  it('names error-prone fields and instructs care, without emitting any past value', () => {
    const section = renderCorrectionHints([
      { fieldName: 'declared_weight', timesCorrected: 3, misreadCount: 3, clearedCount: 0 },
      { fieldName: 'vat_number', timesCorrected: 2, misreadCount: 0, clearedCount: 2 },
    ])
    expect(section).toContain('declared_weight')
    expect(section).toContain('vat_number')
    // Must not carry copyable values, and must warn against copying.
    expect(section.toLowerCase()).toContain('this document')
    expect(section).not.toContain('1000')
    expect(section).not.toContain('GB123')
  })

  it('distinguishes mis-read guidance from over-extraction guidance', () => {
    const misread = renderCorrectionHints([{ fieldName: 'f', timesCorrected: 2, misreadCount: 2, clearedCount: 0 }])
    const cleared = renderCorrectionHints([{ fieldName: 'g', timesCorrected: 2, misreadCount: 0, clearedCount: 2 }])
    expect(misread).not.toBe(cleared)
  })
})
