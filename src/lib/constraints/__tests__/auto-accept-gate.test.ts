import { routeAutoAcceptToReview } from '../auto-accept-gate'
import type { PlannedFlag } from '../plan-flags'

// Upgrade 3 — auto-accept physics gate. Auto-accepted documents get no human
// review, so if the brain finds a physically-impossible / inconsistent record we
// route the document back to review. Conservative default: ANY constraint flag,
// of any severity, is enough — an unreviewed doc that fails the physics gets eyes.

function flag(severity: PlannedFlag['severity']): PlannedFlag {
  return { dataRecordId: 'r1', flagType: 'INTERNAL_INCONSISTENCY', message: 'physics failed', severity }
}

describe('routeAutoAcceptToReview', () => {
  it('routes to review on a CRITICAL constraint flag', () => {
    expect(routeAutoAcceptToReview([flag('CRITICAL')])).toBe(true)
  })

  it('routes to review even on a sole WARNING — conservative "let a human see it" default', () => {
    expect(routeAutoAcceptToReview([flag('WARNING')])).toBe(true)
  })

  it('leaves a clean document auto-accepted (no flags → no reroute)', () => {
    expect(routeAutoAcceptToReview([])).toBe(false)
  })
})
