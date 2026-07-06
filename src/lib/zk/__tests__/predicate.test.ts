import {
  evaluatePredicate,
  statementDigest,
  type Predicate,
  type EvalRecord,
} from '../predicate'

// Upgrade 8 — the statement layer a ZK proof attests to (proving system aside).
// The predicate templates evaluate over the witness records, and a predicate
// binds to a Merkle root as one deterministic public digest.

describe('evaluatePredicate — numeric inequality', () => {
  const records: EvalRecord[] = [
    { field: 'scope1_tco2e', value: 30 },
    { field: 'scope1_tco2e', value: 45 },
  ]
  it('satisfies when the aggregate meets the threshold', () => {
    const p: Predicate = { kind: 'numeric_inequality', field: 'scope1_tco2e', aggregate: 'sum', op: '<', threshold: 100 }
    const r = evaluatePredicate(p, records)
    expect(r.observed).toBe(75)
    expect(r.satisfied).toBe(true)
  })
  it('fails when it does not', () => {
    const p: Predicate = { kind: 'numeric_inequality', field: 'scope1_tco2e', aggregate: 'sum', op: '<', threshold: 50 }
    expect(evaluatePredicate(p, records).satisfied).toBe(false)
  })
})

describe('evaluatePredicate — set membership', () => {
  it('satisfies when no forbidden category is present', () => {
    const records: EvalRecord[] = [
      { field: 'country_of_origin', category: 'GB' },
      { field: 'country_of_origin', category: 'DE' },
    ]
    const p: Predicate = { kind: 'set_membership', field: 'country_of_origin', forbidden: ['RU', 'KP'] }
    expect(evaluatePredicate(p, records).satisfied).toBe(true)
  })
  it('fails when a forbidden category appears', () => {
    const records: EvalRecord[] = [{ field: 'country_of_origin', category: 'RU' }]
    const p: Predicate = { kind: 'set_membership', field: 'country_of_origin', forbidden: ['RU', 'KP'] }
    expect(evaluatePredicate(p, records).satisfied).toBe(false)
  })
})

describe('evaluatePredicate — weighted sum threshold', () => {
  it('computes a ratio and compares (renewable share > 50%)', () => {
    const records: EvalRecord[] = [
      { field: 'renewable_kwh', value: 60 },
      { field: 'total_kwh', value: 100 },
    ]
    const p: Predicate = { kind: 'weighted_sum_threshold', numeratorField: 'renewable_kwh', denominatorField: 'total_kwh', op: '>', threshold: 0.5 }
    const r = evaluatePredicate(p, records)
    expect(r.observed).toBeCloseTo(0.6)
    expect(r.satisfied).toBe(true)
  })
  it('is safe when the denominator is zero', () => {
    const p: Predicate = { kind: 'weighted_sum_threshold', numeratorField: 'renewable_kwh', denominatorField: 'total_kwh', op: '>', threshold: 0.5 }
    expect(evaluatePredicate(p, []).observed).toBe(0)
  })
})

describe('statementDigest', () => {
  const p: Predicate = { kind: 'numeric_inequality', field: 'scope1_tco2e', aggregate: 'sum', op: '<', threshold: 100 }

  it('is deterministic for the same root + predicate', () => {
    expect(statementDigest({ merkleRoot: 'abc', predicate: p })).toBe(
      statementDigest({ merkleRoot: 'abc', predicate: p }),
    )
  })

  it('changes when the root changes', () => {
    expect(statementDigest({ merkleRoot: 'abc', predicate: p })).not.toBe(
      statementDigest({ merkleRoot: 'xyz', predicate: p }),
    )
  })

  it('changes when the predicate threshold changes', () => {
    const p2: Predicate = { ...p, threshold: 200 }
    expect(statementDigest({ merkleRoot: 'abc', predicate: p })).not.toBe(
      statementDigest({ merkleRoot: 'abc', predicate: p2 }),
    )
  })
})
