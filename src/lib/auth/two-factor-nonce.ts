// Server-verifiable proof that a TOTP/recovery challenge was actually passed.
//
// The /2fa-verify page can only ask the session to upgrade past the pending2fa
// state by presenting a nonce that /api/auth/2fa/complete minted after checking
// the code. Only the SHA-256 hash of the nonce is stored, alongside a short
// expiry, so a database leak exposes nothing usable and a stolen nonce is dead
// within minutes. The nonce is single-use: consuming it clears the stored hash.

import { randomBytes, createHash } from 'crypto'

/** A verification nonce is valid for two minutes — one hop from code entry to session upgrade. */
export const TWO_FACTOR_NONCE_TTL_MS = 2 * 60 * 1000

export interface GeneratedNonce {
  /** Raw nonce returned to the client. Never stored. */
  nonce: string
  /** SHA-256 hash of the nonce. Stored on the user. */
  nonceHash: string
  /** When the nonce stops being valid. */
  expiresAt: Date
}

export function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex')
}

export function generateVerificationNonce(now: Date = new Date()): GeneratedNonce {
  const nonce = randomBytes(32).toString('base64url')
  return {
    nonce,
    nonceHash: hashNonce(nonce),
    expiresAt: new Date(now.getTime() + TWO_FACTOR_NONCE_TTL_MS),
  }
}

/**
 * Whether a stored nonce record matches the presented raw nonce and is unexpired.
 * A null stored hash (already consumed, or never issued) never matches.
 */
export function isNonceValid(
  record: { nonceHash: string | null; expiresAt: Date | null },
  presented: string,
  now: Date = new Date(),
): boolean {
  if (!record.nonceHash || !record.expiresAt) return false
  if (record.expiresAt.getTime() <= now.getTime()) return false
  return hashNonce(presented) === record.nonceHash
}
