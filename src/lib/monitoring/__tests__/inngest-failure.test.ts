import { inngestFailureReport } from '../inngest-failure'

// When an Inngest function exhausts its retries, nothing else reports it: the
// error is returned to Inngest, not thrown in a request Sentry sees. This turns
// Inngest's `inngest/function.failed` event into one Sentry report.

const failure = {
  function_id: 'arbor-extract-document',
  run_id: '01JABCDEF',
  error: {
    name: 'TypeError',
    message: 'Cannot read properties of undefined',
    stack: 'TypeError: …\n    at x',
  },
  event: {
    name: 'document/uploaded',
    data: { documentId: 'doc_1', emailBody: 'Dear supplier, our kWh were 41,200' },
  },
}

describe('inngestFailureReport', () => {
  // Expected: an Error with the original name, message and stack.
  // Reason: Sentry groups and shows it like any thrown error.
  it('rebuilds the error', () => {
    const { error } = inngestFailureReport(failure)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('TypeError')
    expect(error.message).toBe('Cannot read properties of undefined')
    expect(error.stack).toBe('TypeError: …\n    at x')
  })

  // Expected: the function, run and triggering event's name as tags; grouped
  // per function and error type. Reason: one broken function is one issue.
  it('tags and groups by function', () => {
    const report = inngestFailureReport(failure)
    expect(report.tags).toEqual({
      'inngest.function': 'arbor-extract-document',
      'inngest.run': '01JABCDEF',
      'inngest.event': 'document/uploaded',
    })
    expect(report.fingerprint).toEqual(['inngest', 'arbor-extract-document', 'TypeError'])
  })

  // Expected: none of the triggering event's data. Reason: it can carry an
  // inbound email or a document's figures, which stay in Arbor.
  it('sends nothing from the triggering event but its name', () => {
    const text = JSON.stringify(inngestFailureReport(failure))
    expect(text).not.toContain('doc_1')
    expect(text).not.toContain('41,200')
  })

  it('copes with a missing or odd error', () => {
    const { error } = inngestFailureReport({
      function_id: 'f',
      run_id: 'r',
      error: undefined,
      event: undefined,
    })
    expect(error.message).toBe('The Inngest function f failed without an error message.')
    expect(inngestFailureReport({ function_id: 'f', run_id: 'r', error: 'boom' }).error.message).toBe('boom')
  })
})
