// A data request's status is a lifecycle, not a set of buttons. Pure: no DB, no
// side effects.
//
// The route used to check only "may this party ever set this status", which let a
// buyer accept a request before anything had been submitted, reopen a closed one,
// and let a supplier mark the same request submitted again and again. Each
// transition is now stated against the status the request is actually in.
import type { RequestStatus } from '@prisma/client'

export type RequestActor = 'BUYER' | 'SUPPLIER'

interface Transition {
  to: RequestStatus
  by: RequestActor[]
}

const TRANSITIONS: Record<RequestStatus, Transition[]> = {
  // Asked, not yet answered.
  PENDING: [
    { to: 'SUBMITTED', by: ['SUPPLIER'] },
    { to: 'QUERY_RAISED', by: ['BUYER', 'SUPPLIER'] },
    { to: 'CLOSED', by: ['BUYER'] },
  ],
  // Answered; the buyer decides what happens next.
  SUBMITTED: [
    { to: 'ACCEPTED', by: ['BUYER'] },
    { to: 'QUERY_RAISED', by: ['BUYER'] },
    { to: 'CLOSED', by: ['BUYER'] },
  ],
  // A question is outstanding; the supplier answers it by submitting again.
  QUERY_RAISED: [
    { to: 'SUBMITTED', by: ['SUPPLIER'] },
    { to: 'CLOSED', by: ['BUYER'] },
  ],
  // The buyer is satisfied. Only closing remains.
  ACCEPTED: [{ to: 'CLOSED', by: ['BUYER'] }],
  // Terminal. Reopening would resurrect a submission link that was deliberately
  // retired, so it is a new request instead.
  CLOSED: [],
}

export type TransitionRefusal = 'terminal' | 'not_from_this_status' | 'not_this_party'

export type TransitionVerdict =
  | { allowed: true }
  | { allowed: false; reason: TransitionRefusal; message: string }

export function canTransitionRequest(
  from: RequestStatus,
  to: RequestStatus,
  actor: RequestActor,
): TransitionVerdict {
  const options = TRANSITIONS[from]

  if (options.length === 0) {
    return {
      allowed: false,
      reason: 'terminal',
      message: 'This request is closed. Send a new request instead.',
    }
  }

  const match = options.find(t => t.to === to)
  if (!match) {
    return {
      allowed: false,
      reason: 'not_from_this_status',
      message: `A request that is ${from.toLowerCase().replace('_', ' ')} cannot move to ${to.toLowerCase().replace('_', ' ')}.`,
    }
  }

  if (!match.by.includes(actor)) {
    return {
      allowed: false,
      reason: 'not_this_party',
      message: 'That is not a change your side of this request can make.',
    }
  }

  return { allowed: true }
}

/** The states from which a public submission link may still be used. Anything
 *  else — already submitted, accepted, or closed — means the link is spent. */
export function canSubmitAgainstStatus(status: RequestStatus): boolean {
  return canTransitionRequest(status, 'SUBMITTED', 'SUPPLIER').allowed
}

/** Statuses a submission may claim from, for the atomic `updateMany` guard. */
export const SUBMITTABLE_STATUSES: RequestStatus[] = (
  Object.keys(TRANSITIONS) as RequestStatus[]
).filter(canSubmitAgainstStatus)
