// The views of the Requests section.
//
// Same quiet ?view= toggle Records and CBAM use. Arbor's design rules forbid
// tabs; a toggle reads the same way without introducing a second navigation
// pattern, and it keeps one primary action per screen.
//
// "Requests you sent" is not a view of its own. It used to sit beside "What you
// shared", and the two read as the same idea — both are outbound history. It now
// lives inside Request data, next to the thing that creates those requests,
// where a list of what you have already asked for is context for asking again
// rather than a separate destination.

export const REQUEST_VIEWS = [
  {
    id: 'waiting',
    label: 'Waiting on you',
    description: 'Requests from buyers that still need an answer.',
  },
  {
    id: 'shared',
    label: 'What you shared',
    description: 'Data you have already sent, and who has it.',
  },
  {
    id: 'request',
    label: 'Request data',
    description: 'Ask a supplier for data, and see what you have already asked for.',
  },
  {
    id: 'questionnaires',
    label: 'Questionnaires',
    description: "Answer a buyer's questionnaire from the data you already hold.",
  },
] as const

export type RequestView = (typeof REQUEST_VIEWS)[number]['id']

const DEFAULT_VIEW: RequestView = 'waiting'

/**
 * Resolve a `?view=` parameter to a known view.
 *
 * Opens on what is waiting, because that is the only view with a deadline
 * attached. An unknown value falls back rather than erroring — a stale link is
 * a navigation hint, not an instruction.
 */
export function resolveRequestView(raw: string | undefined | null): RequestView {
  const match = REQUEST_VIEWS.find(v => v.id === raw)
  return match ? match.id : DEFAULT_VIEW
}
