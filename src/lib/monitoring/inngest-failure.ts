// Turns Inngest's `inngest/function.failed` event into one Sentry report. Pure.
//
// A function that exhausts its retries returns its error to Inngest rather than
// throwing in a request Sentry sees, so without this nobody hears of it. Only the
// function, the run and the triggering event's name are sent: the event's data
// can carry an inbound email or a document's figures, which stay in Arbor.

export interface InngestFailure {
  function_id: string
  run_id: string
  error?: unknown
  event?: unknown
}

export interface InngestFailureReport {
  error: Error
  tags: Record<string, string>
  fingerprint: string[]
}

export function inngestFailureReport(failure: InngestFailure): InngestFailureReport {
  const raw = failure.error
  const fields = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const message =
    typeof raw === 'string'
      ? raw
      : typeof fields.message === 'string' && fields.message
        ? fields.message
        : `The Inngest function ${failure.function_id} failed without an error message.`

  const error = new Error(message)
  if (typeof fields.name === 'string') error.name = fields.name
  if (typeof fields.stack === 'string') error.stack = fields.stack

  const event =
    failure.event && typeof failure.event === 'object' ? (failure.event as Record<string, unknown>) : {}
  const tags: Record<string, string> = {
    'inngest.function': failure.function_id,
    'inngest.run': failure.run_id,
  }
  if (typeof event.name === 'string') tags['inngest.event'] = event.name

  return { error, tags, fingerprint: ['inngest', failure.function_id, error.name] }
}
