// High-entropy opaque tokens for public URLs (share links, submission links).
//
// The raw token is handed out once (in the URL) and never stored. Only its
// SHA-256 hash is persisted, so a database leak does not expose usable links —
// the same reasoning as password-reset tokens. Full entropy means there is no
// brute-force concern, so a fast deterministic hash is used and lookups are a
// direct single-row `where: { tokenHash }`.
import { randomBytes, createHash } from 'crypto'

/** Generate a fresh 256-bit URL-safe token. Return value is the RAW token. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

/** SHA-256 hash (hex) of a raw token — this is what gets stored and looked up. */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
