// Pure header validation — no DB access, no side effects.
// Used by api-key-auth.ts and testable in isolation.

export interface HeaderValidationResult {
  authorized: boolean
  rawKey: string | null
  reason: string | null
}

export function validateAuthHeader(authHeader: string | null): HeaderValidationResult {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authorized: false, rawKey: null, reason: 'Missing or malformed Authorization header' }
  }

  const rawKey = authHeader.slice(7).trim()
  if (!rawKey) {
    return { authorized: false, rawKey: null, reason: 'Empty API key' }
  }

  return { authorized: true, rawKey, reason: null }
}
