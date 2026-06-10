import { computeReadinessScore, type ReadinessInput } from '../readiness-score'

function makeRecord(
  id: string,
  domain: string,
  trustTier: 'A' | 'B' | 'C',
): ReadinessInput['records'][0] {
  return { id, domain, trustTier }
}

describe('computeReadinessScore', () => {
  it('all Tier A → overall HIGH, 100% score', () => {
    const input: ReadinessInput = {
      records: [
        makeRecord('r1', 'ENERGY', 'A'),
        makeRecord('r2', 'FREIGHT', 'A'),
        makeRecord('r3', 'MATERIALS', 'A'),
      ],
    }
    const result = computeReadinessScore(input)
    expect(result.overallScore).toBe(100)
    expect(result.interpretation).toBe('HIGH')
  })

  it('all Tier C → overall LOW, 0% score', () => {
    const input: ReadinessInput = {
      records: [
        makeRecord('r1', 'ENERGY', 'C'),
        makeRecord('r2', 'FREIGHT', 'C'),
      ],
    }
    const result = computeReadinessScore(input)
    expect(result.overallScore).toBe(0)
    expect(result.interpretation).toBe('LOW')
  })

  it('mixed A and C → score is percentage of Tier A', () => {
    const input: ReadinessInput = {
      records: [
        makeRecord('r1', 'ENERGY', 'A'),
        makeRecord('r2', 'ENERGY', 'A'),
        makeRecord('r3', 'ENERGY', 'C'),
        makeRecord('r4', 'ENERGY', 'C'),
      ],
    }
    const result = computeReadinessScore(input)
    expect(result.overallScore).toBe(50)
  })

  // interpretation thresholds: HIGH ≥75%, MEDIUM ≥40%, LOW <40%
  it('75% Tier A → HIGH', () => {
    const input: ReadinessInput = {
      records: [
        makeRecord('r1', 'ENERGY', 'A'),
        makeRecord('r2', 'ENERGY', 'A'),
        makeRecord('r3', 'ENERGY', 'A'),
        makeRecord('r4', 'ENERGY', 'C'),
      ],
    }
    const result = computeReadinessScore(input)
    expect(result.interpretation).toBe('HIGH')
  })

  it('50% Tier A → MEDIUM', () => {
    const input: ReadinessInput = {
      records: [
        makeRecord('r1', 'ENERGY', 'A'),
        makeRecord('r2', 'ENERGY', 'C'),
      ],
    }
    const result = computeReadinessScore(input)
    expect(result.interpretation).toBe('MEDIUM')
  })

  it('25% Tier A → LOW', () => {
    const input: ReadinessInput = {
      records: [
        makeRecord('r1', 'ENERGY', 'A'),
        makeRecord('r2', 'ENERGY', 'C'),
        makeRecord('r3', 'ENERGY', 'C'),
        makeRecord('r4', 'ENERGY', 'C'),
      ],
    }
    const result = computeReadinessScore(input)
    expect(result.interpretation).toBe('LOW')
  })

  it('per-domain breakdown reflects each domain independently', () => {
    const input: ReadinessInput = {
      records: [
        makeRecord('r1', 'ENERGY', 'A'),
        makeRecord('r2', 'ENERGY', 'A'),
        makeRecord('r3', 'FREIGHT', 'C'),
        makeRecord('r4', 'FREIGHT', 'C'),
      ],
    }
    const result = computeReadinessScore(input)
    const energy = result.byDomain.find((d) => d.domain === 'ENERGY')!
    const freight = result.byDomain.find((d) => d.domain === 'FREIGHT')!
    expect(energy.score).toBe(100)
    expect(energy.interpretation).toBe('HIGH')
    expect(freight.score).toBe(0)
    expect(freight.interpretation).toBe('LOW')
  })

  it('Tier B counts as non-Tier-A (score excludes Tier B)', () => {
    const input: ReadinessInput = {
      records: [
        makeRecord('r1', 'ENERGY', 'A'),
        makeRecord('r2', 'ENERGY', 'B'),
        makeRecord('r3', 'ENERGY', 'B'),
        makeRecord('r4', 'ENERGY', 'B'),
      ],
    }
    const result = computeReadinessScore(input)
    expect(result.overallScore).toBe(25)
  })

  it('empty records → score 0, LOW', () => {
    const result = computeReadinessScore({ records: [] })
    expect(result.overallScore).toBe(0)
    expect(result.interpretation).toBe('LOW')
    expect(result.byDomain).toHaveLength(0)
  })

  it('is a pure function  -  same inputs always return same outputs', () => {
    const input: ReadinessInput = {
      records: [makeRecord('r1', 'ENERGY', 'A'), makeRecord('r2', 'ENERGY', 'C')],
    }
    const a = computeReadinessScore(input)
    const b = computeReadinessScore(input)
    expect(a.overallScore).toBe(b.overallScore)
  })
})
