import {
  canTransitionRequest,
  canSubmitAgainstStatus,
  SUBMITTABLE_STATUSES,
} from '../status-machine'

describe('canTransitionRequest — the happy path', () => {
  it('lets a supplier answer a pending request', () => {
    expect(canTransitionRequest('PENDING', 'SUBMITTED', 'SUPPLIER').allowed).toBe(true)
  })

  it('lets a buyer accept a submitted request', () => {
    expect(canTransitionRequest('SUBMITTED', 'ACCEPTED', 'BUYER').allowed).toBe(true)
  })

  it('lets a buyer query a submitted request, and the supplier answer the query', () => {
    expect(canTransitionRequest('SUBMITTED', 'QUERY_RAISED', 'BUYER').allowed).toBe(true)
    expect(canTransitionRequest('QUERY_RAISED', 'SUBMITTED', 'SUPPLIER').allowed).toBe(true)
  })

  it('lets a buyer close a request at any live stage', () => {
    for (const from of ['PENDING', 'SUBMITTED', 'QUERY_RAISED', 'ACCEPTED'] as const) {
      expect(canTransitionRequest(from, 'CLOSED', 'BUYER').allowed).toBe(true)
    }
  })
})

describe('canTransitionRequest — the transitions the old permission check allowed', () => {
  // A buyer could accept a request nobody had answered.
  it('refuses acceptance before anything has been submitted', () => {
    const verdict = canTransitionRequest('PENDING', 'ACCEPTED', 'BUYER')
    expect(verdict).toMatchObject({ allowed: false, reason: 'not_from_this_status' })
  })

  // A closed request could be pulled back into a query state.
  it('refuses to reopen a closed request', () => {
    expect(canTransitionRequest('CLOSED', 'QUERY_RAISED', 'BUYER')).toMatchObject({
      allowed: false,
      reason: 'terminal',
    })
    expect(canTransitionRequest('CLOSED', 'SUBMITTED', 'SUPPLIER')).toMatchObject({
      allowed: false,
      reason: 'terminal',
    })
  })

  // A supplier could mark the same request submitted repeatedly.
  it('refuses a second submission against an already-submitted request', () => {
    expect(canTransitionRequest('SUBMITTED', 'SUBMITTED', 'SUPPLIER')).toMatchObject({
      allowed: false,
      reason: 'not_from_this_status',
    })
  })

  it('refuses a submission against an accepted request', () => {
    expect(canTransitionRequest('ACCEPTED', 'SUBMITTED', 'SUPPLIER')).toMatchObject({
      allowed: false,
      reason: 'not_from_this_status',
    })
  })
})

describe('canTransitionRequest — party separation', () => {
  it('does not let a supplier accept their own submission', () => {
    expect(canTransitionRequest('SUBMITTED', 'ACCEPTED', 'SUPPLIER')).toMatchObject({
      allowed: false,
      reason: 'not_this_party',
    })
  })

  it('does not let a supplier close a request', () => {
    expect(canTransitionRequest('PENDING', 'CLOSED', 'SUPPLIER')).toMatchObject({
      allowed: false,
      reason: 'not_this_party',
    })
  })

  it('does not let a buyer submit on the supplier’s behalf', () => {
    expect(canTransitionRequest('PENDING', 'SUBMITTED', 'BUYER')).toMatchObject({
      allowed: false,
      reason: 'not_this_party',
    })
  })
})

describe('submission-link admissibility', () => {
  it('allows a link to be used while the request is open or queried', () => {
    expect(canSubmitAgainstStatus('PENDING')).toBe(true)
    expect(canSubmitAgainstStatus('QUERY_RAISED')).toBe(true)
  })

  // The defect: only SUBMITTED and ACCEPTED were blocked, so a link kept working
  // after the buyer closed the request.
  it('treats the link as spent once the request is submitted, accepted or closed', () => {
    expect(canSubmitAgainstStatus('SUBMITTED')).toBe(false)
    expect(canSubmitAgainstStatus('ACCEPTED')).toBe(false)
    expect(canSubmitAgainstStatus('CLOSED')).toBe(false)
  })

  it('exposes the same set for the atomic claim guard', () => {
    expect([...SUBMITTABLE_STATUSES].sort()).toEqual(['PENDING', 'QUERY_RAISED'])
  })
})
