import { lookup } from 'node:dns/promises'
import {
  validateOutboundUrl,
  isPrivateAddress,
  OUTBOUND_URL_MESSAGES,
  type OutboundUrlRejection,
} from '@/lib/net/ssrf-guard'

// Outbound HTTP for tenant-supplied destinations: webhook deliveries and ERP
// integration pulls. Every request goes through the SSRF rules, resolves DNS and
// checks the resolved addresses, follows redirects by hand (re-checking each hop,
// because a 302 to 169.254.169.254 defeats a check done only on the first URL),
// times out, and refuses to buffer an unbounded response.
//
// Honest limit: the address is checked after resolution and before the connect,
// but the connection is not pinned to the address that was checked. A DNS
// rebinding attack with a sub-second TTL can still slip between the two. Closing
// that needs connection-level pinning; this narrows the window rather than
// eliminating it.

export class OutboundRequestError extends Error {
  constructor(
    message: string,
    readonly reason: OutboundUrlRejection | 'too_many_redirects' | 'response_too_large',
  ) {
    super(message)
    this.name = 'OutboundRequestError'
  }
}

export interface SafeFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  /** Wall-clock budget for the whole request, redirects included. */
  timeoutMs?: number
  /** Hard cap on the buffered response body. */
  maxBytes?: number
  maxRedirects?: number
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 5_000_000
const DEFAULT_MAX_REDIRECTS = 3

function reject(reason: OutboundUrlRejection): never {
  throw new OutboundRequestError(OUTBOUND_URL_MESSAGES[reason], reason)
}

/** Validates the URL string and confirms every address it resolves to is public. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const verdict = validateOutboundUrl(raw)
  if (!verdict.ok) reject(verdict.reason)

  const host = verdict.url.hostname.replace(/^\[|\]$/g, '')
  // An IP literal was already settled by validateOutboundUrl.
  if (/^[\d.]+$/.test(host) || host.includes(':')) return verdict.url

  let addresses: { address: string }[]
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    reject('blocked_host')
  }
  if (addresses.length === 0) reject('blocked_host')
  // Every answer must be public — one private A record is enough to reach inside.
  if (addresses.some(a => isPrivateAddress(a.address))) reject('private_address')

  return verdict.url
}

export interface SafeFetchResponse {
  status: number
  ok: boolean
  /** Body text, truncated at maxBytes — see `truncated`. */
  text: string
  truncated: boolean
  finalUrl: string
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
  } = opts

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let target = await assertPublicUrl(raw)

    for (let hop = 0; ; hop++) {
      const res = await fetch(target, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: controller.signal,
      })

      const isRedirect = res.status >= 300 && res.status < 400 && res.headers.has('location')
      if (!isRedirect) {
        const { text, truncated } = await readCapped(res, maxBytes)
        return { status: res.status, ok: res.ok, text, truncated, finalUrl: target.toString() }
      }

      if (hop >= maxRedirects) {
        throw new OutboundRequestError('Too many redirects.', 'too_many_redirects')
      }
      // Re-validate the hop: the destination is now chosen by the remote server.
      const next = new URL(res.headers.get('location')!, target)
      target = await assertPublicUrl(next.toString())
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

async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
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
