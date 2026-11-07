// One ID per request (E6): set by the proxy, read by server code, sent to
// Nucleos as X-Request-Id (which Nucleos logs), and returned to the browser, so
// one action can be followed from a user's report through both systems' logs.
import { headers } from 'next/headers'

export const REQUEST_ID_HEADER = 'x-request-id'

// Echoed into logs and response headers, so a caller-supplied value is kept
// only if it is plainly an identifier.
const PLAIN_ID = /^[A-Za-z0-9_-]{8,128}$/

export function acceptRequestId(incoming: string | null | undefined): string {
  return incoming && PLAIN_ID.test(incoming) ? incoming : crypto.randomUUID()
}

/** The current request's ID; a fresh one outside a request (a script, a test). */
export async function currentRequestId(): Promise<string> {
  try {
    return acceptRequestId((await headers()).get(REQUEST_ID_HEADER))
  } catch {
    return crypto.randomUUID()
  }
}
