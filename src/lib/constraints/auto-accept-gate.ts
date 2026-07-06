// Upgrade 3 — auto-accept physics gate (Layer 1: reads DB, flips workflow status).
//
// Auto-accepted documents (low-stakes, written straight to Tier B) get NO human
// review. If the brain's algebraic-constraint check finds a physically impossible
// or internally inconsistent record on such a document, we route it back to human
// review — an unreviewed doc that fails the physics must not sit silently in the
// store. This is the more consequential of the two intake gaps: confirmed docs
// have two lines of defence (human review + constraint flags), auto-accepted docs
// had zero.
//
// Conservative default: ANY constraint flag, of any severity, routes to review.
//
// The reroute is a workflow-STATUS flip on the Document (ACCEPTED → REVIEW_REQUIRED),
// NOT a data correction: the records and their trust tier are unchanged, so the
// audit chain / immutability model ("records are never overwritten") is untouched.
// If the human later corrects a value, that goes through the normal supersede path.
// Post-write and fail-soft — if the brain is down, no flags are raised and the
// document simply stays auto-accepted (degrade, never block).

import { prisma } from '@/lib/prisma'
import { runConstraintValidation } from './run-constraint-validation'
import type { PlannedFlag } from './plan-flags'

/** Pure policy: route an auto-accepted doc to review iff any constraint flag was raised. */
export function routeAutoAcceptToReview(flags: PlannedFlag[]): boolean {
  return flags.length > 0
}

export interface AutoAcceptGateResult {
  routedToReview: boolean
  flagsRaised: number
}

export async function gateAutoAcceptOnConstraints(
  documentId: string,
): Promise<AutoAcceptGateResult> {
  const flags = await runConstraintValidation(documentId)
  if (!routeAutoAcceptToReview(flags)) {
    return { routedToReview: false, flagsRaised: flags.length }
  }
  await prisma.document.update({
    where: { id: documentId },
    data: { status: 'REVIEW_REQUIRED' },
  })
  return { routedToReview: true, flagsRaised: flags.length }
}
