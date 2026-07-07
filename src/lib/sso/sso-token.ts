// short-lived, HMAC-signed token that proves a WorkOS authentication
// succeeded, so the NextAuth `workos` credentials provider can establish the
// session without a password. Format: base64url(userId.expiry).hexsig
import { createHmac, timingSafeEqual } from 'crypto'

const DEFAULT_TTL_MS = 2 * 60 * 1000 // 2 minutes — single hop from callback to sign-in

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET is not set')
  return s
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex')
}

export function mintSsoToken(userId: string, expiresAt: number = Date.now() + DEFAULT_TTL_MS): string {
  const payload = `${userId}.${expiresAt}`
  const encoded = Buffer.from(payload).toString('base64url')
  return `${encoded}.${sign(payload)}`
}

export function verifySsoToken(token: string): string | null {
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

  const [userId, expiryStr] = payload.split('.')
  const expiry = Number(expiryStr)
  if (!userId || !Number.isFinite(expiry) || Date.now() > expiry) return null
  return userId
}
