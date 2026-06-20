import { isGenericExtraction, parseGenericExtractionResponse, buildGenericExtractionPrompt } from '../generic'

describe('isGenericExtraction', () => {
  it('is true for OTHER', () => {
    expect(isGenericExtraction('OTHER')).toBe(true)
  })
  it('is true for an unknown document type', () => {
    expect(isGenericExtraction('LEASE_AGREEMENT')).toBe(true)
  })
  it('is false for a document type with an admissibility spec', () => {
    expect(isGenericExtraction('ELECTRICITY_BILL')).toBe(false)
    expect(isGenericExtraction('CBAM_DECLARATION')).toBe(false)
  })
})

describe('parseGenericExtractionResponse', () => {
  it('extracts documentClass and fields from a well-formed response', () => {
    const raw = JSON.stringify({
      documentClass: 'lease_agreement',
      extractionNotes: 'commercial lease',
      fields: [
        { fieldName: 'monthly_rent', rawValue: '4500', rawUnit: 'GBP', sourceText: 'Rent: £4,500/month', confidenceScore: 0.95, flagged: false, flagReason: null },
      ],
    })
    const out = parseGenericExtractionResponse(raw)
    expect(out.success).toBe(true)
    expect(out.documentClass).toBe('lease_agreement')
    expect(out.fields).toHaveLength(1)
    expect(out.fields[0].fieldName).toBe('monthly_rent')
  })

  it('returns documentClass null when absent', () => {
    const out = parseGenericExtractionResponse(JSON.stringify({ fields: [] }))
    expect(out.success).toBe(true)
    expect(out.documentClass).toBeNull()
    expect(out.fields).toEqual([])
  })

  it('fails gracefully on non-JSON', () => {
    const out = parseGenericExtractionResponse('not json at all')
    expect(out.success).toBe(false)
    expect(out.fields).toEqual([])
  })
})

describe('buildGenericExtractionPrompt', () => {
  it('asks for documentClass and a fields array', () => {
    const p = buildGenericExtractionPrompt()
    expect(p).toContain('documentClass')
    expect(p).toContain('fields')
  })
})
