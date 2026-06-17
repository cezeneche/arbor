// Pure, DB-free helpers for password reset tokens.
// Used by the forgot-password / reset-password API routes and testable in isolation.
//
// A reset token is a high-entropy random string emailed to the user. Only its
// SHA-256 hash is stored, so a database leak does not expose usable tokens.
// Because the token has full entropy there is no brute-force concern, so a fast
// deterministic hash (SHA-256) is used rather than bcrypt — this also allows a
// direct single-row lookup by hash.

import { randomBytes, createHash } from 'crypto'

/** Reset links are valid for one hour. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000

export interface GeneratedResetToken {
  /** The raw token to embed in the emailed link. Never stored. */
  token: string
  /** SHA-256 hash of the token. Stored in the database. */
  tokenHash: string
  /** When the token stops being valid. */
  expiresAt: Date
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateResetToken(now: Date = new Date()): GeneratedResetToken {
  const token = randomBytes(32).toString('base64url')
  return {
    token,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
  }
}

export function isResetTokenUsable(
  record: { expiresAt: Date; usedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (record.usedAt) return false
  return record.expiresAt.getTime() > now.getTime()
}
