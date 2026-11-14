// What the Anthropic SDK actually sends, through a stand-in for the network.
// The other AI tests mock the SDK, so they cannot see these. An SDK upgrade
// that changes any of them should fail here and be reviewed, not slip in.
import Anthropic from '@anthropic-ai/sdk'
import { AI_CALL_LIMITS } from '@/lib/ai/anthropic-client'

function recordingFetch() {
  const headers: Headers[] = []
  const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    headers.push(new Headers(init?.headers))
    return new Response(
      JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'unavailable' } }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      },
    )
  }
  return { headers, fetch: fetch as typeof globalThis.fetch }
}

async function failedCall(kind: keyof typeof AI_CALL_LIMITS) {
  const recorder = recordingFetch()
  const client = new Anthropic({ apiKey: 'sk-test', ...AI_CALL_LIMITS[kind], fetch: recorder.fetch })
  await expect(
    client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  ).rejects.toBeInstanceOf(Anthropic.InternalServerError)
  return { client, headers: recorder.headers }
}

describe('Anthropic SDK on the wire', () => {
  // Expected: API version 2026-10-21. Reason: the request rules Arbor's calls
  // were checked against (no sampling parameters, documents only in user
  // messages, no citations sent back) are that version's.
  it('sends API version 2026-10-21', async () => {
    const { headers } = await failedCall('interactive')
    expect(headers[0].get('anthropic-version')).toBe('2026-10-21')
  })

  // Expected: the key as a bearer token, and no X-Api-Key. Reason: SDK 1.x moved
  // it; anything between Arbor and the API that reads X-Api-Key would break.
  it('sends the API key as a bearer token', async () => {
    const { headers } = await failedCall('interactive')
    expect(headers[0].get('authorization')).toBe('Bearer sk-test')
    expect(headers[0].get('x-api-key')).toBeNull()
  })

  // Expected: one attempt plus our retries, and our timeout. Reason: these are
  // what keep a call inside its Vercel function (E4); the SDK's defaults are
  // ten minutes and two retries.
  it.each(['interactive', 'background', 'extraction'] as const)(
    'keeps the %s limits',
    async kind => {
      const { client, headers } = await failedCall(kind)
      expect(headers).toHaveLength(AI_CALL_LIMITS[kind].maxRetries + 1)
      expect(client.timeout).toBe(AI_CALL_LIMITS[kind].timeout)
    },
    60_000,
  )
})
