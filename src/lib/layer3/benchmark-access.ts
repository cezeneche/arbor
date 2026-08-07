// Layer 3 — Access. Pure, read-only.
//
// Benchmarks are reciprocal. The distributions exist only because companies put
// their verified records into the anonymised pool, so reading the pool is earned
// by contributing to it. An entity that has not switched sharing on sees the
// benchmark surface locked, with one plain English sentence telling it where the
// switch is (PRD §16.3 minimum-population floor, §19.3 explicit consent).

export interface BenchmarkConsentSource {
  allowBenchmarkAggregation: boolean
}

export interface BenchmarkAccess {
  unlocked: boolean
  /** Plain English explanation of the lock; null when unlocked. */
  reason: string | null
}

const LOCKED_REASON =
  'Benchmarks are shared both ways. Turn on data sharing in Settings and your verified ' +
  'records join the anonymous pool for your sector — which unlocks the pool for you. ' +
  'Your business is never named in any figure, and you can switch it off again at any time.'

export function resolveBenchmarkAccess(
  entity: BenchmarkConsentSource | null | undefined,
): BenchmarkAccess {
  if (!entity?.allowBenchmarkAggregation) {
    return { unlocked: false, reason: LOCKED_REASON }
  }
  return { unlocked: true, reason: null }
}
