import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { rateLimitKey } from '@/lib/rate-limit-pure'

// Sliding-window rate limiting backed by Upstash Redis.
// The client is instantiated lazily so `next build` never needs the secrets,
// and the limiter fails OPEN when Upstash is unconfigured (availability over
// strictness) — a warning is logged in production so misconfig is visible.

type Duration = `${number} ${'s' | 'm' | 'h' | 'd'}`

export interface RateLimitConfig {
  prefix: string
  limit: number
  window: Duration
}

export const RATE_LIMITS = {
  // Keyed by IP: blocks password spray without letting anyone lock out a victim by email.
  login: { prefix: 'login', limit: 8, window: '10 m' },
  // Keyed by IP: caps reset-email spam.
  forgotPassword: { prefix: 'forgot-pw', limit: 5, window: '60 m' },
  // Keyed by IP: tokens are 256-bit so this is abuse protection, not anti-brute-force.
  resetPassword: { prefix: 'reset-pw', limit: 10, window: '60 m' },
  // Keyed by user id: the real anti-brute-force gate for the 6-digit TOTP / recovery codes.
  twoFactor: { prefix: '2fa', limit: 6, window: '10 m' },
} as const satisfies Record<string, RateLimitConfig>

let _redis: Redis | null = null
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  if (!_redis) _redis = new Redis({ url, token })
  return _redis
}

const limiterCache = new Map<string, Ratelimit>()
function getLimiter(config: RateLimitConfig): Ratelimit | null {
  const redis = getRedis()
  if (!redis) return null
  const cacheKey = `${config.prefix}:${config.limit}:${config.window}`
  let limiter = limiterCache.get(cacheKey)
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(config.limit, config.window),
      prefix: `ratelimit:${config.prefix}`,
      analytics: false,
    })
    limiterCache.set(cacheKey, limiter)
  }
  return limiter
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
}

/**
 * Check (and consume) one unit of the given limit for `identifier`.
 * Returns { allowed: false } when the caller has exceeded the window.
 */
export async function checkRateLimit(
  config: RateLimitConfig,
  identifier: string,
): Promise<RateLimitResult> {
  const limiter = getLimiter(config)
  if (!limiter) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(`[rate-limit] Upstash not configured — '${config.prefix}' is not being enforced`)
    }
    return { allowed: true, remaining: config.limit }
  }
  try {
    const { success, remaining } = await limiter.limit(rateLimitKey(config.prefix, identifier))
    return { allowed: success, remaining }
  } catch (e) {
    // Never let a Redis hiccup take down auth — fail open, but log it.
    console.error('[rate-limit] check failed, allowing request:', e)
    return { allowed: true, remaining: config.limit }
  }
}
