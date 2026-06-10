import { crossValidate } from '../cross-validation'

const baseInput = {
  entityId: 'ent_001',
  documentAId: 'doc_a',
  documentBId: 'doc_b',
  fieldName: 'shipment_weight',
}

describe('crossValidate  -  pure function', () => {
  it('passes when values are within tolerance', () => {
    const result = crossValidate({ ...baseInput, valueA: 1000, valueB: 1010, tolerancePercent: 2 })
    expect(result.passed).toBe(true)
    expect(result.discrepancyPercent).toBeCloseTo(1, 1)
  })

  it('fails when values exceed tolerance', () => {
    const result = crossValidate({ ...baseInput, valueA: 1000, valueB: 1050, tolerancePercent: 2 })
    expect(result.passed).toBe(false)
    expect(result.discrepancyPercent).toBeCloseTo(4.76, 1)
  })

  it('passes when both values are exactly zero', () => {
    const result = crossValidate({ ...baseInput, valueA: 0, valueB: 0, tolerancePercent: 0 })
    expect(result.passed).toBe(true)
    expect(result.discrepancyPercent).toBe(0)
    expect(result.message).toContain('Both values are zero')
  })

  it('fails at exactly tolerance + epsilon', () => {
    const result = crossValidate({ ...baseInput, valueA: 100, valueB: 103, tolerancePercent: 2 })
    expect(result.passed).toBe(false)
  })

  it('passes at exactly tolerance', () => {
    const result = crossValidate({ ...baseInput, valueA: 100, valueB: 102, tolerancePercent: 2 })
    expect(result.passed).toBe(true)
  })

  it('uses the larger value as reference denominator', () => {
    // 90 vs 100: discrepancy = |90-100| / 100 = 10%
    const result = crossValidate({ ...baseInput, valueA: 90, valueB: 100, tolerancePercent: 5 })
    expect(result.discrepancyPercent).toBeCloseTo(10, 5)
    expect(result.passed).toBe(false)
  })

  it('zero-tolerance rule: any discrepancy fails (REGO vs meter read)', () => {
    const result = crossValidate({ ...baseInput, valueA: 1000, valueB: 1001, tolerancePercent: 0 })
    expect(result.passed).toBe(false)
  })

  it('message contains both values on failure', () => {
    const result = crossValidate({ ...baseInput, valueA: 500, valueB: 700, tolerancePercent: 5 })
    expect(result.message).toContain('500')
    expect(result.message).toContain('700')
  })
})
