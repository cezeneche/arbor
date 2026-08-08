import { crossValidate, periodsOverlap, unitsComparable } from '../cross-validation'

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

describe('crossValidate — directional ceiling rules', () => {
  const base = {
    entityId: 'e1',
    documentAId: 'a',
    documentBId: 'b',
    fieldName: 'total_consumption_kwh',
    tolerancePercent: 0,
    comparison: 'B_MUST_NOT_EXCEED_A' as const,
  }

  // The defect: "REGO quantity must not exceed metered consumption" was written as
  // an agreement with zero tolerance, so a certificate covering LESS than the
  // metered consumption — the normal, correct case — failed.
  it('passes when B is below A, which is the ordinary case', () => {
    const result = crossValidate({ ...base, valueA: 100000, valueB: 40000 })
    expect(result.passed).toBe(true)
    expect(result.discrepancyPercent).toBe(0)
  })

  it('passes when B equals A', () => {
    expect(crossValidate({ ...base, valueA: 100000, valueB: 100000 }).passed).toBe(true)
  })

  it('fails when B exceeds A — the double-counting case the rule exists for', () => {
    const result = crossValidate({ ...base, valueA: 100000, valueB: 120000 })
    expect(result.passed).toBe(false)
    expect(result.message).toContain('exceeds')
  })

  it('is not symmetric — swapping the values changes the verdict', () => {
    expect(crossValidate({ ...base, valueA: 120000, valueB: 100000 }).passed).toBe(true)
    expect(crossValidate({ ...base, valueA: 100000, valueB: 120000 }).passed).toBe(false)
  })

  it('still agrees symmetrically under the default comparison', () => {
    const a = crossValidate({ ...base, comparison: 'AGREE', valueA: 100, valueB: 110, tolerancePercent: 20 })
    const b = crossValidate({ ...base, comparison: 'AGREE', valueA: 110, valueB: 100, tolerancePercent: 20 })
    expect(a.passed).toBe(true)
    expect(b.passed).toBe(true)
  })
})

describe('periodsOverlap', () => {
  const q1 = { periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-03-31') }
  const q2 = { periodStart: new Date('2026-04-01'), periodEnd: new Date('2026-06-30') }

  it('is true for the same period', () => {
    expect(periodsOverlap(q1, q1)).toBe(true)
  })

  // The defect: every accepted counterpart was compared regardless of period, so a
  // Q1 invoice was checked against a Q4 delivery note.
  it('is false for periods that do not touch', () => {
    expect(periodsOverlap(q1, q2)).toBe(false)
  })

  it('is true when one period contains the other', () => {
    const year = { periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-12-31') }
    expect(periodsOverlap(q1, year)).toBe(true)
    expect(periodsOverlap(year, q1)).toBe(true)
  })

  it('is true when periods share a single boundary day', () => {
    const touching = { periodStart: new Date('2026-03-31'), periodEnd: new Date('2026-05-31') }
    expect(periodsOverlap(q1, touching)).toBe(true)
  })
})

describe('unitsComparable', () => {
  it('compares only like with like', () => {
    expect(unitsComparable('mj', 'MJ')).toBe(true)
    expect(unitsComparable(' kg ', 'kg')).toBe(true)
    expect(unitsComparable('mj', 'kg')).toBe(false)
  })
})
