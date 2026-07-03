import {
  binaryEntropy,
  importanceWeight,
  expectedInformationGain,
  rankReviewFields,
  LOW_INFO_GAIN,
  type RankableField,
} from '../information-gain'

// Upgrade 2 — active-learning review ranking. Order which field the human should
// confirm next by expected information gain: how uncertain we are about it
// (entropy of its correctness) weighted by how much it matters (compulsory >
// optional; flagged matters more). Fields we're confident about AND that don't
// matter much are marked low-information so the UI can de-emphasise them —
// exactly the "stop asking about fields whose confirmation adds nothing" goal.

function field(over: Partial<RankableField> & { fieldName: string }): RankableField {
  return { admissibility: 'COMPULSORY', confidence: 0.8, flagged: false, hasValue: true, ...over }
}

describe('binaryEntropy', () => {
  it('is maximal at 0.5 and zero at the extremes', () => {
    expect(binaryEntropy(0.5)).toBeCloseTo(1, 6)
    expect(binaryEntropy(0)).toBe(0)
    expect(binaryEntropy(1)).toBe(0)
  })
})

describe('importanceWeight', () => {
  it('ranks compulsory > conditional > optional', () => {
    expect(importanceWeight('COMPULSORY', false)).toBeGreaterThan(importanceWeight('CONDITIONAL', false))
    expect(importanceWeight('CONDITIONAL', false)).toBeGreaterThan(importanceWeight('OPTIONAL', false))
  })

  it('boosts a flagged field', () => {
    expect(importanceWeight('OPTIONAL', true)).toBeGreaterThan(importanceWeight('OPTIONAL', false))
  })
})

describe('expectedInformationGain', () => {
  it('is higher for a more uncertain field at equal importance', () => {
    const uncertain = expectedInformationGain(field({ fieldName: 'a', confidence: 0.55 }))
    const confident = expectedInformationGain(field({ fieldName: 'b', confidence: 0.95 }))
    expect(uncertain).toBeGreaterThan(confident)
  })

  it('is higher for a more important field at equal uncertainty', () => {
    const comp = expectedInformationGain(field({ fieldName: 'a', admissibility: 'COMPULSORY', confidence: 0.7 }))
    const opt = expectedInformationGain(field({ fieldName: 'b', admissibility: 'OPTIONAL', confidence: 0.7 }))
    expect(comp).toBeGreaterThan(opt)
  })
})

describe('rankReviewFields', () => {
  it('orders fields by expected information gain, highest first', () => {
    const ranked = rankReviewFields([
      field({ fieldName: 'confident_optional', admissibility: 'OPTIONAL', confidence: 0.98 }),
      field({ fieldName: 'uncertain_compulsory', admissibility: 'COMPULSORY', confidence: 0.55 }),
    ])
    expect(ranked.map(r => r.fieldName)).toEqual(['uncertain_compulsory', 'confident_optional'])
    expect(ranked[0].gain).toBeGreaterThan(ranked[1].gain)
  })

  it('marks a near-certain, unimportant field as low information', () => {
    const [r] = rankReviewFields([field({ fieldName: 'x', admissibility: 'OPTIONAL', confidence: 0.99 })])
    expect(r.gain).toBeLessThan(LOW_INFO_GAIN)
    expect(r.lowInformation).toBe(true)
  })

  it('never marks a flagged field as low information', () => {
    const [r] = rankReviewFields([field({ fieldName: 'x', admissibility: 'OPTIONAL', confidence: 0.999, flagged: true })])
    expect(r.lowInformation).toBe(false)
  })

  it('never marks a missing field as low information', () => {
    const [r] = rankReviewFields([field({ fieldName: 'x', admissibility: 'OPTIONAL', confidence: 0.999, hasValue: false })])
    expect(r.lowInformation).toBe(false)
  })

  it('breaks ties deterministically by field name', () => {
    const ranked = rankReviewFields([
      field({ fieldName: 'b', confidence: 0.8 }),
      field({ fieldName: 'a', confidence: 0.8 }),
    ])
    expect(ranked.map(r => r.fieldName)).toEqual(['a', 'b'])
  })
})
