// Layer 3 — Access. Pure, read-only. No DB, no AI, no value transformation.
//
// Upgrade 6 — Lattice-theoretic tier composition.
//
// Trust tiers form a semilattice ordered C ≺ B ≺ A (Estimated is weakest,
// Verified is strongest). This module answers the question the rest of the
// platform never had a defined answer for: "what tier is a *set* of records?".
//
// The answer is the MEET — the lowest tier present — because an aggregate is
// only as trustworthy as its weakest member. A composite claim built from two
// Verified records and one Declared record cannot honestly be presented as
// Verified; its tier is Declared. Alongside the meet we carry the distribution
// (what fraction of the set reaches each tier) so buyers keep full visibility
// and can set minimum-acceptance thresholds against the meet.
//
// Every export, questionnaire answer, and buyer response that aggregates more
// than one record reports both the meet and the distribution.

export type Tier = 'A' | 'B' | 'C'

// Rank in the semilattice: higher = more trusted. The meet is the tier with
// the lowest rank present in the set.
const RANK: Record<Tier, number> = { C: 0, B: 1, A: 2 }
const TIERS: readonly Tier[] = ['A', 'B', 'C']

/** Pairwise meet: the lower-ranked (less trusted) of two tiers. */
export function meetTier(a: Tier, b: Tier): Tier {
  return RANK[a] <= RANK[b] ? a : b
}

export interface TierComposition {
  /**
   * Lowest tier present — the honest tier of the whole aggregate.
   * `null` for an empty aggregate: no records means no tier claim.
   */
  meet: Tier | null
  /** Record count per tier. */
  counts: Record<Tier, number>
  /** Fraction per tier in [0, 1]; sums to 1 for a non-empty aggregate, all 0 when empty. */
  distribution: Record<Tier, number>
  /** Number of records folded into this composition. */
  total: number
}

/**
 * Fold a set of record tiers into its aggregate tier (meet) plus distribution.
 * Order-independent — meet is commutative and associative.
 */
export function composeTiers(tiers: Tier[]): TierComposition {
  const counts: Record<Tier, number> = { A: 0, B: 0, C: 0 }
  for (const t of tiers) counts[t]++

  const total = tiers.length
  const distribution: Record<Tier, number> = { A: 0, B: 0, C: 0 }

  if (total === 0) {
    return { meet: null, counts, distribution, total }
  }

  let meet: Tier = 'A' // top element; folds down toward the weakest present
  for (const t of TIERS) {
    distribution[t] = counts[t] / total
    if (counts[t] > 0) meet = meetTier(meet, t)
  }

  return { meet, counts, distribution, total }
}

/**
 * Buyer minimum-acceptance gate: does the aggregate's meet reach `threshold`?
 * An empty aggregate never meets any threshold — no data cannot satisfy a
 * minimum-tier requirement.
 */
export function aggregateMeetsThreshold(tiers: Tier[], threshold: Tier): boolean {
  const { meet } = composeTiers(tiers)
  if (meet === null) return false
  return RANK[meet] >= RANK[threshold]
}
