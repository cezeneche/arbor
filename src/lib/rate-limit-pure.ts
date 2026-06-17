// Pure helpers for rate limiting — no Upstash/network dependency, unit-tested.

/** Resolve the caller's IP from proxy headers. Vercel sets x-forwarded-for. */
export function getClientIp(forwardedFor: string | null, realIp?: string | null): string {
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) return first
  }
  if (realIp) return realIp
  return 'unknown'
}

/** Build a stable, case-insensitive rate-limit key. */
export function rateLimitKey(prefix: string, identifier: string): string {
  return `${prefix}:${identifier.toLowerCase()}`
}
