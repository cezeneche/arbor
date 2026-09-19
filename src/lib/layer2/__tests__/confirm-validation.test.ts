import { validateConfirmFields } from '../confirm-validation'

const field = (over: Partial<Parameters<typeof validateConfirmFields>[0][number]> = {}) => ({
  fieldName: 'total_consumption_kwh',
  confirmedValue: '1234.5',
  confirmedUnit: 'kwh',
  periodStart: '2026-01-01T00:00:00.000Z',
  periodEnd: '2026-03-31T00:00:00.000Z',
  ...over,
})

describe('validateConfirmFields', () => {
  it('accepts a well-formed field', () => {
    expect(validateConfirmFields([field()])).toEqual([])
  })

  // The defect: unparseable values were skipped, and a payload of nothing but bad
  // values still marked the document ACCEPTED with zero records behind it.
  it('rejects a value that is not a number instead of skipping it', () => {
    const errors = validateConfirmFields([field({ confirmedValue: 'about 40,000ish' })])
    expect(errors).toHaveLength(1)
    expect(errors[0].problem).toBe('not_a_number')
  })

  it('rejects an empty value', () => {
    expect(validateConfirmFields([field({ confirmedValue: '' })])[0].problem).toBe('not_a_number')
  })

  it('accepts a formatted number with separators', () => {
    expect(validateConfirmFields([field({ confirmedValue: '1,234,567.8' })])).toEqual([])
  })

  it('rejects a period that ends before it starts', () => {
    const errors = validateConfirmFields([
      field({ periodStart: '2026-03-31T00:00:00.000Z', periodEnd: '2026-01-01T00:00:00.000Z' }),
    ])
    expect(errors[0].problem).toBe('period_end_not_after_start')
  })

  it('rejects a zero-length period', () => {
    const same = '2026-01-01T00:00:00.000Z'
    expect(validateConfirmFields([field({ periodStart: same, periodEnd: same })])[0].problem).toBe(
      'period_end_not_after_start',
    )
  })

  it('rejects a field name the document type does not define', () => {
    const errors = validateConfirmFields([field({ fieldName: 'invented_field' })], {
      knownFieldNames: new Set(['total_consumption_kwh']),
    })
    expect(errors[0].problem).toBe('unknown_field')
  })

  it('does not police field names when the document type has no definition on file', () => {
    expect(validateConfirmFields([field({ fieldName: 'anything' })], { knownFieldNames: new Set() })).toEqual([])
  })

  // A unit that cannot be normalised cannot be converted on output, which is the
  // one thing Layer 3 promises every recipient.
  it('rejects a unit Arbor cannot normalise', () => {
    expect(validateConfirmFields([field({ confirmedUnit: 'squiggles' })])[0].problem).toBe(
      'unsupported_unit',
    )
  })

  it('allows a field with no unit at all', () => {
    expect(validateConfirmFields([field({ confirmedUnit: undefined })])).toEqual([])
  })

  it('rejects the same field given twice for the same period', () => {
    const errors = validateConfirmFields([field(), field()])
    expect(errors.map(e => e.problem)).toContain('duplicate_field_period')
  })

  it('allows the same field for two different periods', () => {
    expect(
      validateConfirmFields([
        field(),
        field({ periodStart: '2026-04-01T00:00:00.000Z', periodEnd: '2026-06-30T00:00:00.000Z' }),
      ]),
    ).toEqual([])
  })

  it('reports every problem, not just the first', () => {
    const errors = validateConfirmFields([
      field({ confirmedValue: 'x', confirmedUnit: 'squiggles' }),
      field({ fieldName: 'other', periodStart: '2026-05-01T00:00:00.000Z', periodEnd: '2026-04-01T00:00:00.000Z' }),
    ])
    expect(errors.map(e => e.problem).sort()).toEqual([
      'not_a_number',
      'period_end_not_after_start',
      'unsupported_unit',
    ])
  })
})
