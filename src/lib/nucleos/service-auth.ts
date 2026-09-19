// The credential and correlation id every Arbor → Nucleos call carries.
//
// One place builds them so every client sends the same thing: the service
// token, and an x-request-id Nucleos logs against the request — so one failure
// can be followed across both services' logs.
import { randomUUID } from 'node:crypto'

export function nucleosHeaders(
  extra: Record<string, string> = {},
  requestId: string = randomUUID(),
): Record<string, string> {
  return {
    authorization: `Bearer ${process.env.NUCLEOS_INTERNAL_TOKEN as string}`,
    'x-request-id': requestId,
    ...extra,
  }
}

export interface TokenExpiry {
  expiresAt: string | null
  /** Whole days until expiry; negative once expired. Null when it never expires. */
  daysLeft: number | null
  expired: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * When the service token expires. Read from the JWT's own claims without
 * verifying it — Arbor does not hold the signing key, and this is monitoring,
 * not authentication. Nothing in Arbor refreshes the token, so an expiry is a
 * date by which someone has to mint and set a new one.
 */
export function serviceTokenExpiry(token: string, now: Date = new Date()): TokenExpiry {
  const none: TokenExpiry = { expiresAt: null, daysLeft: null, expired: false }
  const payload = token.split('.')[1]
  if (!payload) return none
  let exp: unknown
  try {
    exp = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp
  } catch {
    return none
  }
  if (typeof exp !== 'number') return none
  const expiresAt = new Date(exp * 1000)
  return {
    expiresAt: expiresAt.toISOString(),
    daysLeft: Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS),
    expired: expiresAt.getTime() <= now.getTime(),
  }
}
