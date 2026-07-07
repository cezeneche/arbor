// Inbound webhook signature verification. Pure and dependency-free (crypto only)
// so it is unit-testable and safe to reason about. Two shapes are supported:
//
//   - WorkOS: header "t=<unix-seconds>, v1=<hex hmac>" where the HMAC is taken
//     over `${t}.${rawBody}` with the endpoint's signing secret. A timestamp
//     tolerance rejects replayed deliveries.
//   - Plain HMAC: header is hex(HMAC-SHA256(secret, rawBody)) — used for providers
//     that only offer a body HMAC. Strictly better than comparing a static token.
//
// All comparisons are constant-time.
import { createHmac, timingSafeEqual } from 'crypto'

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** Verify a plain hex HMAC-SHA256 of the raw body. */
export function verifyBodyHmac(rawBody: string, signatureHex: string | null, secret: string): boolean {
  if (!signatureHex) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  return safeEqualHex(signatureHex.trim().toLowerCase(), expected)
}

interface WorkosSignatureParts {
  timestamp: number | null
  signature: string | null
}

export function parseWorkosSignatureHeader(header: string | null): WorkosSignatureParts {
  if (!header) return { timestamp: null, signature: null }
  let timestamp: number | null = null
  let signature: string | null = null
  for (const part of header.split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim())
    if (k === 't') {
      const n = Number(v)
      timestamp = Number.isFinite(n) ? n : null
    } else if (k === 'v1') {
      signature = v ?? null
    }
  }
  return { timestamp, signature }
}

/**
 * Verify a WorkOS-style signed webhook. Rejects when the signature is absent,
 * mismatched, or the timestamp is outside `toleranceSec` of `now` (replay guard).
 */
export function verifyWorkosSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  opts: { now?: Date; toleranceSec?: number } = {},
): boolean {
  const { timestamp, signature } = parseWorkosSignatureHeader(header)
  if (timestamp === null || !signature) return false

  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000)
  const tolerance = opts.toleranceSec ?? 300
  if (Math.abs(nowSec - timestamp) > tolerance) return false

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  return safeEqualHex(signature.toLowerCase(), expected)
}
