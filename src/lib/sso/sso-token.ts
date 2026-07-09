// Short-lived, HMAC-signed, SINGLE-USE token that proves a WorkOS authentication
// succeeded, so the NextAuth `workos` credentials provider can establish the
// session without a password. Format: base64url(userId.expiry.nonce).hexsig
//
// The HMAC + expiry stop forgery and replay-after-expiry; the nonce (stored
// hashed on the user, cleared on first use) stops replay within the TTL — the
// token in the redirect URL can be used exactly once.
import { createHmac, timingSafeEqual, randomBytes, createHash } from 'crypto'
import { prisma } from '@/lib/prisma'

const DEFAULT_TTL_MS = 2 * 60 * 1000 // 2 minutes — single hop from callback to sign-in

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET is not set')
  return s
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex')
}

function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex')
}

export interface SsoTokenParts {
  userId: string
  expiry: number
  nonce: string
}

/** Pure: build a signed token from its parts. */
export function buildSsoToken(userId: string, expiry: number, nonce: string): string {
  const payload = `${userId}.${expiry}.${nonce}`
  const encoded = Buffer.from(payload).toString('base64url')
  return `${encoded}.${sign(payload)}`
}

/** Pure: verify signature + expiry and return the parts. Does NOT check single-use. */
export function parseSsoToken(token: string, now: number = Date.now()): SsoTokenParts | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [encoded, sig] = parts
  let payload: string
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const expected = sign(payload)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const [userId, expiryStr, nonce] = payload.split('.')
  const expiry = Number(expiryStr)
  if (!userId || !nonce || !Number.isFinite(expiry) || now > expiry) return null
  return { userId, expiry, nonce }
}

/** Mint a single-use token: store the nonce hash on the user, return the token. */
export async function mintSsoToken(
  userId: string,
  expiresAt: number = Date.now() + DEFAULT_TTL_MS,
): Promise<string> {
  const nonce = randomBytes(16).toString('hex')
  await prisma.user.update({
    where: { id: userId },
    data: { ssoNonceHash: hashNonce(nonce), ssoNonceExpires: new Date(expiresAt) },
  })
  return buildSsoToken(userId, expiresAt, nonce)
}

/**
 * Consume a token exactly once: verify signature/expiry, then atomically clear the
 * stored nonce. Returns the userId only for the single call that consumes it — a
 * replay finds the nonce already cleared and gets null.
 */
export async function consumeSsoToken(token: string): Promise<string | null> {
  const parts = parseSsoToken(token)
  if (!parts) return null
  const consumed = await prisma.user.updateMany({
    where: {
      id: parts.userId,
      ssoNonceHash: hashNonce(parts.nonce),
      ssoNonceExpires: { gt: new Date() },
    },
    data: { ssoNonceHash: null, ssoNonceExpires: null },
  })
  if (consumed.count !== 1) return null
  return parts.userId
}
