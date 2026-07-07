// auto-accept physics gate (Layer 1: reads DB, flips workflow status).
//
// Auto-accepted documents (low-stakes, written straight to Tier B) get NO human
// review. If the brain's algebraic-constraint check finds a physically impossible
// record on such a document, we route it back to human review — an unreviewed doc
// that fails the physics must not sit silently in the store. This is the more
// consequential of the two intake gaps: confirmed docs have two lines of defence
// (human review + constraint flags), auto-accepted docs had zero.
//
// Reroute policy: only a CRITICAL violation reroutes (negative mass, impossible
// percentage, implausible sector intensity). A WARNING — currently only a >5%-off
// MASS_BALANCE — is still FLAGGED on the record but leaves the document
// auto-accepted, so soft tolerance-band cases don't flood the review queue. The
// threshold is a one-line knob (routeAutoAcceptToReview) if that judgement changes.
//
// The reroute is a workflow-STATUS flip on the Document (ACCEPTED → REVIEW_REQUIRED),
// NOT a data correction: the records and their trust tier are unchanged, so the
// audit chain / immutability model ("records are never overwritten") is untouched.
// If the human later corrects a value, that goes through the normal supersede path.
// Post-write and fail-soft — if the brain is down, no flags are raised and the
// document simply stays auto-accepted (degrade, never block). Idempotent: the flag
// write dedups (see runConstraintValidation) and the status flip is a no-op if the
// document is already REVIEW_REQUIRED, so an inngest step retry cannot double-write.

import { prisma } from '@/lib/prisma'
import { runConstraintValidation } from './run-constraint-validation'
import type { PlannedFlag } from './plan-flags'

/** Pure policy: route an auto-accepted doc to review iff any CRITICAL constraint flag was raised. */
export function routeAutoAcceptToReview(flags: PlannedFlag[]): boolean {
  return flags.some((f) => f.severity === 'CRITICAL')
}

export interface AutoAcceptGateResult {
  routedToReview: boolean
  flagsRaised: number
}

/** Injectable seams so the gate's control flow is testable without a DB. */
export interface AutoAcceptGateDeps {
  runValidation?: (documentId: string) => Promise<PlannedFlag[]>
  setReviewRequired?: (documentId: string) => Promise<void>
}

async function defaultSetReviewRequired(documentId: string): Promise<void> {
  // Idempotent: only flips a still-ACCEPTED doc, so a step retry (or a human who
  // already re-accepted) is never clobbered back to REVIEW_REQUIRED.
  await prisma.document.updateMany({
    where: { id: documentId, status: 'ACCEPTED' },
    data: { status: 'REVIEW_REQUIRED' },
  })
}

export async function gateAutoAcceptOnConstraints(
  documentId: string,
  deps: AutoAcceptGateDeps = {},
): Promise<AutoAcceptGateResult> {
  const runValidation = deps.runValidation ?? runConstraintValidation
  const setReviewRequired = deps.setReviewRequired ?? defaultSetReviewRequired

  const flags = await runValidation(documentId)
  if (!routeAutoAcceptToReview(flags)) {
    return { routedToReview: false, flagsRaised: flags.length }
  }
  await setReviewRequired(documentId)
  return { routedToReview: true, flagsRaised: flags.length }
}
