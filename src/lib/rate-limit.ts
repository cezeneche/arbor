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
  // Gap 7a — keyed by IP: caps automated account creation.
  signup: { prefix: 'signup', limit: 5, window: '60 m' },
  // Gap 7a — keyed by IP: caps probing of public supplier submission links.
  submitToken: { prefix: 'submit-token', limit: 30, window: '10 m' },
  // Gap 4 — keyed by IP: caps probing of the public audit-package verify endpoint.
  verifyPublic: { prefix: 'verify-public', limit: 10, window: '1 m' },
  // Gap 6 — keyed by entity (API key): buyer query API budget.
  buyerApi: { prefix: 'buyer-api', limit: 100, window: '1 m' },
  // Keyed by IP: caps spam to the public institutional enquiry form.
  institutionalEnquiry: { prefix: 'inst-enquiry', limit: 5, window: '60 m' },
  // Keyed by share token: collapses repeated views into one access-log write per window.
  shareView: { prefix: 'share-view', limit: 1, window: '5 m' },
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
 * How to behave when the limiter cannot run (Upstash unconfigured or Redis error).
 *   'open'   — allow the request (availability over strictness). Default.
 *   'closed' — deny the request. Use where the limiter is the only brute-force
 *              gate and a silent bypass is unacceptable (TOTP verify, login).
 */
export type RateLimitFailMode = 'open' | 'closed'

export interface CheckRateLimitOptions {
  failMode?: RateLimitFailMode
}

/**
 * Check (and consume) one unit of the given limit for `identifier`.
 * Returns { allowed: false } when the caller has exceeded the window, or when the
 * limiter is unavailable and `failMode` is 'closed'.
 */
export async function checkRateLimit(
  config: RateLimitConfig,
  identifier: string,
  opts: CheckRateLimitOptions = {},
): Promise<RateLimitResult> {
  const failMode = opts.failMode ?? 'open'
  const limiter = getLimiter(config)
  if (!limiter) {
    // Missing config is a deploy error on a fail-closed path — surface it loudly.
    const log = failMode === 'closed' ? console.error : console.warn
    if (failMode === 'closed' || process.env.NODE_ENV === 'production') {
      log(`[rate-limit] Upstash not configured — '${config.prefix}' failing ${failMode}`)
    }
    return { allowed: failMode === 'open', remaining: failMode === 'open' ? config.limit : 0 }
  }
  try {
    const { success, remaining } = await limiter.limit(rateLimitKey(config.prefix, identifier))
    return { allowed: success, remaining }
  } catch (e) {
    // A Redis hiccup must not silently drop a fail-closed brute-force gate.
    console.error(`[rate-limit] check failed for '${config.prefix}', failing ${failMode}:`, e)
    return { allowed: failMode === 'open', remaining: failMode === 'open' ? config.limit : 0 }
  }
}
