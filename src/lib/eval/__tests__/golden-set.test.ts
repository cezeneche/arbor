import { parseGoldenSet, parseBaseline, EMPTY_BASELINE } from '../golden-set'

// Pre-deploy eval gate — golden-set / baseline parsing. Validates the on-disk
// eval manifest so a malformed case fails loudly at load, not mid-run.

describe('parseGoldenSet', () => {
  it('parses a well-formed golden set', () => {
    const cases = parseGoldenSet({
      cases: [
        { id: 'bill', documentType: 'ELECTRICITY_BILL', fixture: 'bill.pdf', mediaType: 'application/pdf', expected: [{ fieldName: 'supplier_name', expectedValue: 'Acme' }, { fieldName: 'vat_number', expectedValue: null }] },
      ],
    })
    expect(cases).toHaveLength(1)
    expect(cases[0].expected[1].expectedValue).toBeNull()
  })

  it('accepts an empty golden set (gate is a no-op until cases are added)', () => {
    expect(parseGoldenSet({ cases: [] })).toEqual([])
  })

  it('rejects an unknown media type', () => {
    expect(() =>
      parseGoldenSet({ cases: [{ id: 'x', documentType: 'T', fixture: 'x.tiff', mediaType: 'image/tiff', expected: [] }] }),
    ).toThrow()
  })

  it('rejects duplicate case ids (they would collide when scoring)', () => {
    expect(() =>
      parseGoldenSet({
        cases: [
          { id: 'dup', documentType: 'T', fixture: 'a.pdf', mediaType: 'application/pdf', expected: [] },
          { id: 'dup', documentType: 'T', fixture: 'b.pdf', mediaType: 'application/pdf', expected: [] },
        ],
      }),
    ).toThrow()
  })

  it('rejects a case missing required fields', () => {
    expect(() => parseGoldenSet({ cases: [{ id: 'x' }] })).toThrow()
  })
})

describe('parseBaseline', () => {
  it('parses a baseline with per-group accuracies', () => {
    const b = parseBaseline({ extractorVersion: 'v1', groups: { mass: 0.9 }, overall: 0.9 })
    expect(b.groups.mass).toBe(0.9)
  })

  it('EMPTY_BASELINE is a valid empty baseline', () => {
    expect(parseBaseline(EMPTY_BASELINE)).toEqual(EMPTY_BASELINE)
  })
})
