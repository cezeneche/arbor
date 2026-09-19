// Where the Redis REST credentials come from. Two names are in play: the
// UPSTASH_ pair this project set by hand, and the KV_ pair the Vercel
// Marketplace integration provisions. Reading either means re-provisioning
// Upstash cannot silently take sign-in down, which the login gate does when
// the limiter has no credentials to reach.
export interface RedisCredentials {
  url: string
  token: string
}

export function redisCredentials(env: Record<string, string | undefined>): RedisCredentials | null {
  const pairs: [string | undefined, string | undefined][] = [
    [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN],
    [env.KV_REST_API_URL, env.KV_REST_API_TOKEN],
  ]
  for (const [url, token] of pairs) {
    if (url && token) return { url, token }
  }
  return null
}
