import { redisCredentials } from '../redis-credentials'

// The Vercel Marketplace integration provisions KV_REST_API_URL / _TOKEN; the
// hand-set variables this project started with were UPSTASH_REDIS_REST_URL /
// _TOKEN. Reading either means re-provisioning Upstash does not silently take
// sign-in down, which is what happened when the first instance disappeared.
describe('redisCredentials', () => {
  const upstash = { UPSTASH_REDIS_REST_URL: 'https://u.example', UPSTASH_REDIS_REST_TOKEN: 'u-token' }
  const kv = { KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 'kv-token' }

  it('reads the UPSTASH_ pair', () => {
    expect(redisCredentials(upstash)).toEqual({ url: 'https://u.example', token: 'u-token' })
  })

  it('reads the KV_ pair the marketplace integration provisions', () => {
    expect(redisCredentials(kv)).toEqual({ url: 'https://kv.example', token: 'kv-token' })
  })

  it('prefers the UPSTASH_ pair when both are set', () => {
    expect(redisCredentials({ ...kv, ...upstash })).toEqual({ url: 'https://u.example', token: 'u-token' })
  })

  it('is null when a pair is incomplete or absent', () => {
    expect(redisCredentials({})).toBeNull()
    expect(redisCredentials({ KV_REST_API_URL: 'https://kv.example' })).toBeNull()
    expect(redisCredentials({ UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' })).toBeNull()
  })
})
