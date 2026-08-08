import { normaliseExtractionResponse, readPositiveIntEnv } from '../response-schema'

const goodField = {
  fieldName: 'total_consumption_kwh',
  rawValue: '4200',
  rawUnit: 'kWh',
  sourceText: 'Total 4,200 kWh',
  confidenceScore: 0.93,
  flagged: false,
  flagReason: null,
}

describe('normaliseExtractionResponse', () => {
  it('reads a well-formed response', () => {
    const result = normaliseExtractionResponse({
      documentTypeConfirmed: 'ELECTRICITY_BILL',
      extractionNotes: 'clean scan',
      fields: [goodField],
    })
    expect(result).toMatchObject({
      documentTypeConfirmed: 'ELECTRICITY_BILL',
      extractionNotes: 'clean scan',
      discardedFieldCount: 0,
    })
    expect(result!.fields[0]).toEqual(goodField)
  })

  it('returns null when the payload is not an object at all', () => {
    expect(normaliseExtractionResponse('sorry, I cannot read this')).toBeNull()
    expect(normaliseExtractionResponse(null)).toBeNull()
    expect(normaliseExtractionResponse([1, 2, 3])).toBeNull()
  })

  it('treats a response with no fields as an empty extraction, not a failure', () => {
    const result = normaliseExtractionResponse({ fields: [] })
    expect(result).toMatchObject({ fields: [], discardedFieldCount: 0 })
  })

  // The defect: the response was cast, not checked, so junk reached the DB and
  // the confidence maths.
  it('discards an entry with no usable field name', () => {
    const result = normaliseExtractionResponse({ fields: [goodField, { rawValue: '9' }, 42] })
    expect(result!.fields).toHaveLength(1)
    expect(result!.discardedFieldCount).toBe(2)
  })

  it('coerces a numeric confidence sent as a string', () => {
    const result = normaliseExtractionResponse({
      fields: [{ ...goodField, confidenceScore: '0.42' }],
    })
    expect(result!.fields[0].confidenceScore).toBeCloseTo(0.42)
  })

  // The 0.85 review threshold is the whole basis of Tier A, so a confidence that
  // is not a number must never present as certain.
  it('treats an unreadable confidence as zero and flags the field', () => {
    const result = normaliseExtractionResponse({
      fields: [{ ...goodField, confidenceScore: 'high' }],
    })
    expect(result!.fields[0].confidenceScore).toBe(0)
    expect(result!.fields[0].flagged).toBe(true)
  })

  it('flags a field whose confidence was omitted entirely', () => {
    const noConfidence = { ...goodField, confidenceScore: undefined }
    const result = normaliseExtractionResponse({ fields: [noConfidence] })
    expect(result!.fields[0].confidenceScore).toBe(0)
    expect(result!.fields[0].flagged).toBe(true)
    expect(result!.fields[0].flagReason).toContain('confident')
  })

  it('clamps a confidence outside [0,1]', () => {
    expect(
      normaliseExtractionResponse({ fields: [{ ...goodField, confidenceScore: 5 }] })!.fields[0]
        .confidenceScore,
    ).toBe(1)
    expect(
      normaliseExtractionResponse({ fields: [{ ...goodField, confidenceScore: -2 }] })!.fields[0]
        .confidenceScore,
    ).toBe(0)
  })

  it('reads a flag sent as a string', () => {
    expect(
      normaliseExtractionResponse({ fields: [{ ...goodField, flagged: 'true' }] })!.fields[0].flagged,
    ).toBe(true)
    expect(
      normaliseExtractionResponse({ fields: [{ ...goodField, flagged: 'no' }] })!.fields[0].flagged,
    ).toBe(false)
  })

  it('defaults a missing source text to empty rather than undefined', () => {
    const noSource = { ...goodField, sourceText: undefined }
    expect(normaliseExtractionResponse({ fields: [noSource] })!.fields[0].sourceText).toBe('')
  })
})

describe('readPositiveIntEnv', () => {
  it('reads a valid setting', () => {
    expect(readPositiveIntEnv('5', 3)).toBe(5)
  })

  // The defect: Number('auto') is NaN, Math.max(1, NaN) is NaN, and the sample
  // count became NaN — sampling silently stopped working.
  it('falls back when the setting is unparseable', () => {
    expect(readPositiveIntEnv('auto', 3)).toBe(3)
    expect(readPositiveIntEnv('', 3)).toBe(3)
    expect(readPositiveIntEnv(undefined, 3)).toBe(3)
  })

  it('falls back for zero, negatives and fractions', () => {
    expect(readPositiveIntEnv('0', 3)).toBe(3)
    expect(readPositiveIntEnv('-4', 3)).toBe(3)
    expect(readPositiveIntEnv('2.5', 3)).toBe(3)
  })

  it('caps an absurd setting rather than letting it run', () => {
    expect(readPositiveIntEnv('100000', 3, 100)).toBe(100)
  })
})
