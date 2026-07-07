import {
  composeTiers,
  meetTier,
  aggregateMeetsThreshold,
  type Tier,
} from '../tier-composition'

// Lattice-theoretic tier composition.
//
// Trust tiers form a semilattice under C ≺ B ≺ A. The tier of an *aggregate*
// of records is the MEET (the lowest tier present) — the honest answer to
// "what tier is this set?". Alongside the meet we report the distribution:
// what fraction of the aggregate achieves each tier. Both travel with every
// composite claim (exports, questionnaire answers, buyer responses).

describe('meetTier — pairwise semilattice meet', () => {
  it('A meet A = A (idempotent)', () => {
    // Reason: meet of equal elements is that element.
    expect(meetTier('A', 'A')).toBe('A')
  })

  it('A meet B = B (lower tier wins)', () => {
    // Reason: an aggregate is only as trustworthy as its weakest member.
    expect(meetTier('A', 'B')).toBe('B')
  })

  it('A meet C = C and B meet C = C', () => {
    expect(meetTier('A', 'C')).toBe('C')
    expect(meetTier('B', 'C')).toBe('C')
  })

  it('is commutative', () => {
    const tiers: Tier[] = ['A', 'B', 'C']
    for (const x of tiers) {
      for (const y of tiers) {
        // Reason: meet is order-independent — a lattice law we rely on when folding.
        expect(meetTier(x, y)).toBe(meetTier(y, x))
      }
    }
  })
})

describe('composeTiers — aggregate meet + distribution', () => {
  it('empty aggregate makes no tier claim', () => {
    // Reason: an aggregate with no records must not assert a tier. Returning A
    // (the lattice top / meet of the empty set) would be a dishonest claim, so
    // the product contract is meet=null with a zeroed distribution.
    const result = composeTiers([])
    expect(result.meet).toBeNull()
    expect(result.total).toBe(0)
    expect(result.counts).toEqual({ A: 0, B: 0, C: 0 })
    expect(result.distribution).toEqual({ A: 0, B: 0, C: 0 })
  })

  it('single Verified record → meet A, full A distribution', () => {
    const result = composeTiers(['A'])
    expect(result.meet).toBe('A')
    expect(result.counts).toEqual({ A: 1, B: 0, C: 0 })
    expect(result.distribution).toEqual({ A: 1, B: 0, C: 0 })
    expect(result.total).toBe(1)
  })

  it('mixed A/A/B → meet is B, distribution reflects the split', () => {
    // Reason: two Verified + one Declared cannot be presented as a Verified set;
    // the meet is B, but 2/3 of the set is A and buyers can see that.
    const result = composeTiers(['A', 'A', 'B'])
    expect(result.meet).toBe('B')
    expect(result.counts).toEqual({ A: 2, B: 1, C: 0 })
    expect(result.distribution.A).toBeCloseTo(2 / 3, 10)
    expect(result.distribution.B).toBeCloseTo(1 / 3, 10)
    expect(result.distribution.C).toBe(0)
    expect(result.total).toBe(3)
  })

  it('any Estimated present drags the meet to C', () => {
    const result = composeTiers(['A', 'B', 'C'])
    expect(result.meet).toBe('C')
    expect(result.counts).toEqual({ A: 1, B: 1, C: 1 })
    expect(result.total).toBe(3)
  })

  it('distribution fractions sum to 1 for any non-empty aggregate', () => {
    const result = composeTiers(['A', 'B', 'B', 'C', 'C', 'C'])
    const sum =
      result.distribution.A + result.distribution.B + result.distribution.C
    expect(sum).toBeCloseTo(1, 10)
  })
})

describe('aggregateMeetsThreshold — buyer minimum-acceptance gate', () => {
  it('a set of all A meets an A threshold', () => {
    // Reason: buyers set a minimum acceptable tier; the meet must clear it.
    expect(aggregateMeetsThreshold(['A', 'A'], 'A')).toBe(true)
  })

  it('a set containing one C fails an A threshold but clears a C threshold', () => {
    expect(aggregateMeetsThreshold(['A', 'C'], 'A')).toBe(false)
    expect(aggregateMeetsThreshold(['A', 'C'], 'C')).toBe(true)
  })

  it('a set of A/B clears a B threshold', () => {
    expect(aggregateMeetsThreshold(['A', 'B'], 'B')).toBe(true)
  })

  it('an empty aggregate never meets any threshold', () => {
    // Reason: no data cannot satisfy a minimum-tier requirement.
    expect(aggregateMeetsThreshold([], 'C')).toBe(false)
  })
})
