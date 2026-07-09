// Pure, DB-free rules for API-key authorisation beyond the secret match:
// expiry, IP allowlisting, and read/write scope. Kept pure so they are unit-tested
// in isolation; authenticateApiKey wires them to the DB row + request.

export type ApiKeyScopeValue = 'READ' | 'READ_WRITE'

/** True once an expiry has passed. A null expiry never expires. */
export function isApiKeyExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime()
}

/** True when the caller IP is permitted. An empty allowlist permits any IP; a
 *  non-empty allowlist requires an exact match (fail closed on unknown IP). */
export function isIpAllowed(ipAllowlist: string[], clientIp: string | null | undefined): boolean {
  if (ipAllowlist.length === 0) return true
  return clientIp != null && clientIp !== 'unknown' && ipAllowlist.includes(clientIp)
}

/** Only a READ_WRITE key may write. */
export function scopeAllowsWrite(scope: ApiKeyScopeValue): boolean {
  return scope === 'READ_WRITE'
}
