import {
  routeAutoAcceptToReview,
  gateAutoAcceptOnConstraints,
} from '../auto-accept-gate'
import type { PlannedFlag } from '../plan-flags'

// auto-accept physics gate. Auto-accepted documents get no human
// review, so if the brain finds a physically IMPOSSIBLE record (a CRITICAL
// violation) we route the document back to review. A WARNING — currently only a
// >5%-off mass balance — is flagged on the record but leaves the doc auto-accepted.

function flag(severity: PlannedFlag['severity']): PlannedFlag {
  return { dataRecordId: 'r1', flagType: 'INTERNAL_INCONSISTENCY', message: 'physics failed', severity }
}

describe('routeAutoAcceptToReview', () => {
  it('routes to review on a CRITICAL constraint flag', () => {
    expect(routeAutoAcceptToReview([flag('CRITICAL')])).toBe(true)
  })

  it('does NOT reroute on a WARNING-only doc — the flag is written but the doc stays auto-accepted', () => {
    expect(routeAutoAcceptToReview([flag('WARNING')])).toBe(false)
  })

  it('reroutes when a CRITICAL is present alongside a WARNING', () => {
    expect(routeAutoAcceptToReview([flag('WARNING'), flag('CRITICAL')])).toBe(true)
  })

  it('leaves a clean document auto-accepted (no flags → no reroute)', () => {
    expect(routeAutoAcceptToReview([])).toBe(false)
  })
})

describe('gateAutoAcceptOnConstraints (control flow, DB-free via injected deps)', () => {
  it('(a) flips the document to review when a CRITICAL violation is found', async () => {
    const rerouted: string[] = []
    const result = await gateAutoAcceptOnConstraints('doc1', {
      runValidation: async () => [flag('CRITICAL')],
      setReviewRequired: async (id) => { rerouted.push(id) },
    })
    expect(result).toEqual({ routedToReview: true, flagsRaised: 1 })
    expect(rerouted).toEqual(['doc1'])
  })

  it('(b) leaves a clean document accepted — never touches status', async () => {
    const rerouted: string[] = []
    const result = await gateAutoAcceptOnConstraints('doc1', {
      runValidation: async () => [],
      setReviewRequired: async (id) => { rerouted.push(id) },
    })
    expect(result).toEqual({ routedToReview: false, flagsRaised: 0 })
    expect(rerouted).toEqual([])
  })

  it('(c) brain down (fail-soft → no flags) leaves the document accepted', async () => {
    const rerouted: string[] = []
    // runConstraintValidation returns [] when the brain is unavailable.
    const result = await gateAutoAcceptOnConstraints('doc1', {
      runValidation: async () => [],
      setReviewRequired: async (id) => { rerouted.push(id) },
    })
    expect(result.routedToReview).toBe(false)
    expect(rerouted).toEqual([])
  })

  it('(d) a WARNING-only doc is not rerouted — status untouched', async () => {
    const rerouted: string[] = []
    const result = await gateAutoAcceptOnConstraints('doc1', {
      runValidation: async () => [flag('WARNING')],
      setReviewRequired: async (id) => { rerouted.push(id) },
    })
    expect(result).toEqual({ routedToReview: false, flagsRaised: 1 })
    expect(rerouted).toEqual([])
  })
})
