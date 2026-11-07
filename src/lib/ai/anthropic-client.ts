// Layer 1 — the one place an Anthropic client is made (E4, production-readiness
// audit). The SDK's default is ten minutes per attempt with two retries, while
// a Vercel function is stopped at 300 seconds: a stuck call was cut off by the
// platform instead of failing as an error its caller handles. Each kind of call
// gets a limit that fits where it runs.
import Anthropic from '@anthropic-ai/sdk'

export const AI_CALL_LIMITS = {
  // A person is waiting: /api/query/nl parses the question, then answers it.
  interactive: { timeout: 15_000, maxRetries: 1 },
  // Short background calls, such as reading an inbound request email.
  background: { timeout: 60_000, maxRetries: 2 },
  // Whole-document reads (up to 8,192 output tokens) inside an Inngest step.
  // No retries here: Inngest retries the step, and two layers would overrun.
  extraction: { timeout: 240_000, maxRetries: 0 },
} as const

export type AiCallKind = keyof typeof AI_CALL_LIMITS

/** The longest a call of this kind can take before it fails, retries included. */
export function worstCaseMs(kind: AiCallKind): number {
  const { timeout, maxRetries } = AI_CALL_LIMITS[kind]
  return timeout * (maxRetries + 1)
}

const clients = new Map<AiCallKind, Anthropic>()

/** apiKey is for tests; the app reads ANTHROPIC_API_KEY as the SDK does. */
export function anthropicClient(kind: AiCallKind, apiKey?: string): Anthropic {
  if (apiKey) return new Anthropic({ apiKey, ...AI_CALL_LIMITS[kind] })
  let client = clients.get(kind)
  if (!client) {
    client = new Anthropic(AI_CALL_LIMITS[kind])
    clients.set(kind, client)
  }
  return client
}
