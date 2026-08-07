// Layer 3 — benchmarks are reciprocal. An entity that contributes its verified
// records to the anonymised pool can read the pool; an entity that does not,
// cannot. PRD §16.3 / §19.3 — consent is granted at onboarding and revocable.

import { resolveBenchmarkAccess } from '../benchmark-access'

describe('resolveBenchmarkAccess', () => {
  it('unlocks benchmarks for an entity that shares its data', () => {
    const access = resolveBenchmarkAccess({ allowBenchmarkAggregation: true })
    expect(access.unlocked).toBe(true)
    expect(access.reason).toBeNull()
  })

  it('locks benchmarks for an entity that does not share its data', () => {
    const access = resolveBenchmarkAccess({ allowBenchmarkAggregation: false })
    expect(access.unlocked).toBe(false)
    expect(access.reason).toBeTruthy()
  })

  it('explains the lock in plain English, naming the setting that opens it', () => {
    const { reason } = resolveBenchmarkAccess({ allowBenchmarkAggregation: false })
    expect(reason).toMatch(/settings/i)
    // No tier codes, no domain codes, no jargon on the SME-facing path.
    expect(reason).not.toMatch(/tier [ABC]\b/i)
    expect(reason).not.toMatch(/aggregation/i)
  })

  it('locks benchmarks when the entity cannot be resolved', () => {
    // A missing entity is never treated as consenting.
    expect(resolveBenchmarkAccess(null).unlocked).toBe(false)
    expect(resolveBenchmarkAccess(undefined).unlocked).toBe(false)
  })
})
