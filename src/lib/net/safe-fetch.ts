import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { fetch as undiciFetch, type Agent } from 'undici'
import {
  validateOutboundUrl,
  isPrivateAddress,
  OUTBOUND_URL_MESSAGES,
  type OutboundUrlRejection,
} from '@/lib/net/ssrf-guard'
import { createPinnedAgent, type PinnedAddress } from '@/lib/net/pinned-agent'

// Outbound HTTP for tenant-supplied destinations: webhook deliveries and ERP
// integration pulls. Every request is checked against the SSRF rules, resolved,
// checked again against the resolved addresses, and then sent down a socket
// pinned to the address that was checked. Redirects are followed by hand and each
// hop goes through the whole procedure again, because after a 302 the destination
// is chosen by the remote server. Time and response size are bounded.
//
// The pin is what makes the address check meaningful. Checking a hostname's
// addresses and then calling fetch() leaves the request to resolve DNS a second
// time when it connects, and a one-second TTL can answer differently — the check
// passes against a public address and the socket opens to 169.254.169.254 anyway.
// There is no second resolution now: see pinned-agent.ts.
//
// TLS is unaffected. The request keeps the real hostname, so the certificate is
// still verified against it; pinning decides where the packets go, not who we
// insist we are talking to.

type UndiciResponse = Awaited<ReturnType<typeof undiciFetch>>

export class OutboundRequestError extends Error {
  constructor(
    message: string,
    readonly reason: OutboundUrlRejection | 'too_many_redirects' | 'response_too_large',
  ) {
    super(message)
    this.name = 'OutboundRequestError'
  }
}

/** Resolves a hostname to its addresses. Injectable so the pinning behaviour can
 *  be tested without depending on real DNS. */
export type HostResolver = (hostname: string) => Promise<PinnedAddress[]>

const systemResolver: HostResolver = async hostname => {
  const results = await lookup(hostname, { all: true })
  return results.map(r => ({ address: r.address, family: r.family === 6 ? 6 : 4 }))
}

/** The pinned fetch. Injectable so the redirect and pinning behaviour can be
 *  tested without a live TLS server, matching the `fetchImpl` seam already used
 *  by the brain clients. Production always uses undici's fetch with the pinned
 *  dispatcher below. */
export type PinnedFetch = (
  url: URL,
  init: {
    method: string
    headers: Record<string, string>
    body?: string
    redirect: 'manual'
    signal: AbortSignal
    dispatcher: Agent
    /** The address the dispatcher is pinned to — surfaced for assertions. */
    pin: PinnedAddress
  },
) => Promise<UndiciResponse>

export interface SafeFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  /** Wall-clock budget for the whole request, redirects included. */
  timeoutMs?: number
  /** Hard cap on the buffered response body. */
  maxBytes?: number
  maxRedirects?: number
  /** Injectable resolver, for tests. */
  resolver?: HostResolver
  /** Injectable transport, for tests. */
  fetchImpl?: PinnedFetch
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 5_000_000
const DEFAULT_MAX_REDIRECTS = 3

function reject(reason: OutboundUrlRejection): never {
  throw new OutboundRequestError(OUTBOUND_URL_MESSAGES[reason], reason)
}

export interface CheckedDestination {
  url: URL
  /** The address the socket will be pinned to. */
  pin: PinnedAddress
}

/**
 * Validates the URL, resolves it, confirms every address it resolves to is
 * public, and returns the one address the request is allowed to reach.
 *
 * Every address is checked rather than just the one being pinned: a hostname
 * that answers with a mix of public and private addresses is not a destination a
 * tenant should be able to nominate, whichever one we happened to pick.
 */
export async function checkDestination(
  raw: string,
  resolver: HostResolver = systemResolver,
): Promise<CheckedDestination> {
  const verdict = validateOutboundUrl(raw)
  if (!verdict.ok) reject(verdict.reason)

  // URL keeps IPv6 literals in brackets; the socket layer wants them without.
  const host = verdict.url.hostname.replace(/^\[|\]$/g, '')

  // An IP literal was already settled by validateOutboundUrl, and there is no DNS
  // step to rebind — net.connect dials a literal directly and never calls lookup.
  const literal = isIP(host)
  if (literal) {
    return { url: verdict.url, pin: { address: host, family: literal === 6 ? 6 : 4 } }
  }

  let addresses: PinnedAddress[]
  try {
    addresses = await resolver(host)
  } catch {
    reject('blocked_host')
  }
  if (addresses.length === 0) reject('blocked_host')
  if (addresses.some(a => isPrivateAddress(a.address))) reject('private_address')

  return { url: verdict.url, pin: addresses[0] }
}

/** @deprecated Use checkDestination — kept so callers wanting only the URL still
 *  get the full check rather than reaching for validateOutboundUrl alone. */
export async function assertPublicUrl(
  raw: string,
  resolver: HostResolver = systemResolver,
): Promise<URL> {
  return (await checkDestination(raw, resolver)).url
}

export interface SafeFetchResponse {
  status: number
  ok: boolean
  /** Body text, truncated at maxBytes — see `truncated`. */
  text: string
  truncated: boolean
  finalUrl: string
  /** The address the final hop was pinned to. */
  pinnedAddress: string
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    resolver = systemResolver,
    fetchImpl = pinnedFetch,
  } = opts

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let target = raw

    for (let hop = 0; ; hop++) {
      const { url, pin } = await checkDestination(target, resolver)
      const agent = createPinnedAgent(pin)

      let redirectTo: string | null = null
      let result: SafeFetchResponse | null = null

      try {
        const res = await fetchImpl(url, {
          method,
          headers,
          body,
          redirect: 'manual',
          signal: controller.signal,
          dispatcher: agent,
          pin,
        })

        const location = res.headers.get('location')
        if (res.status >= 300 && res.status < 400 && location) {
          // Drain rather than leave the socket half-read before the agent closes.
          await res.body?.cancel().catch(() => {})
          redirectTo = new URL(location, url).toString()
        } else {
          const { text, truncated } = await readCapped(res, maxBytes)
          result = {
            status: res.status,
            ok: res.status >= 200 && res.status < 300,
            text,
            truncated,
            finalUrl: url.toString(),
            pinnedAddress: pin.address,
          }
        }
      } finally {
        // The agent is bound to one address, so it is never reused across hops.
        await closeAgent(agent)
      }

      if (result) return result
      if (hop >= maxRedirects) {
        throw new OutboundRequestError('Too many redirects.', 'too_many_redirects')
      }
      // The next hop is validated, resolved and pinned from scratch: after a 302
      // the destination is the remote server's choice, not the tenant's.
      target = redirectTo!
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Convenience wrapper for JSON APIs. Throws on non-2xx and on oversized bodies. */
export async function safeFetchJson<T = unknown>(
  raw: string,
  opts: SafeFetchOptions & { label?: string } = {},
): Promise<T> {
  const label = opts.label ?? 'Request'
  const res = await safeFetch(raw, opts)
  if (!res.ok) throw new Error(`${label} failed: ${res.status}`)
  if (res.truncated) {
    throw new OutboundRequestError(`${label} returned more data than allowed.`, 'response_too_large')
  }
  return JSON.parse(res.text) as T
}

/** The real transport: undici's fetch, dispatched through the pinned agent. */
const pinnedFetch: PinnedFetch = (url, init) =>
  undiciFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    redirect: init.redirect,
    signal: init.signal,
    dispatcher: init.dispatcher,
  })

async function closeAgent(agent: Agent): Promise<void> {
  try {
    // destroy(), not close(): close() waits for in-flight requests to settle, and
    // this runs on the abort path too, where the in-flight request is precisely
    // what is not going to settle. The agent is single-use and its body has
    // already been read or cancelled by this point, so there is nothing to drain.
    await agent.destroy()
  } catch {
    // A teardown failure must not mask the request's own outcome.
  }
}

async function readCapped(
  res: UndiciResponse,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader()
  if (!reader) return { text: '', truncated: false }

  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)))
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
    chunks.push(value)
  }

  return { text: Buffer.concat(chunks).toString('utf8'), truncated }
}
