import { getClientIp, rateLimitKey } from '../rate-limit-pure'

describe('getClientIp', () => {
  it('returns the first IP from x-forwarded-for', () => {
    expect(getClientIp('203.0.113.1, 70.41.3.18, 150.172.238.178')).toBe('203.0.113.1')
  })

  it('trims whitespace around the first IP', () => {
    expect(getClientIp('  203.0.113.5  , 10.0.0.1')).toBe('203.0.113.5')
  })

  it('handles a single IP with no comma', () => {
    expect(getClientIp('198.51.100.7')).toBe('198.51.100.7')
  })

  it('falls back to x-real-ip when forwarded-for is null', () => {
    expect(getClientIp(null, '198.51.100.9')).toBe('198.51.100.9')
  })

  it('returns "unknown" when nothing is available', () => {
    expect(getClientIp(null, null)).toBe('unknown')
    expect(getClientIp(null)).toBe('unknown')
  })

  it('ignores an empty forwarded-for and uses the fallback', () => {
    expect(getClientIp('', '198.51.100.2')).toBe('198.51.100.2')
  })
})

describe('rateLimitKey', () => {
  it('namespaces the identifier under the prefix', () => {
    expect(rateLimitKey('login', '203.0.113.1')).toBe('login:203.0.113.1')
  })

  it('lowercases the identifier so casing cannot multiply the budget', () => {
    expect(rateLimitKey('forgot-pw', 'User@Example.com')).toBe('forgot-pw:user@example.com')
  })
})
