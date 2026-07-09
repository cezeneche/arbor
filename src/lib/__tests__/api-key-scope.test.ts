import { isApiKeyExpired, isIpAllowed, scopeAllowsWrite } from '@/lib/api-key-scope'

describe('isApiKeyExpired', () => {
  it('a null expiry never expires', () => {
    expect(isApiKeyExpired(null)).toBe(false)
  })
  it('a future expiry is not expired', () => {
    expect(isApiKeyExpired(new Date(Date.now() + 60_000))).toBe(false)
  })
  it('a past expiry is expired', () => {
    expect(isApiKeyExpired(new Date(Date.now() - 1))).toBe(true)
  })
})

describe('isIpAllowed', () => {
  it('an empty allowlist permits any IP', () => {
    expect(isIpAllowed([], '1.2.3.4')).toBe(true)
    expect(isIpAllowed([], null)).toBe(true)
  })
  it('a non-empty allowlist requires an exact match', () => {
    expect(isIpAllowed(['1.2.3.4'], '1.2.3.4')).toBe(true)
    expect(isIpAllowed(['1.2.3.4'], '5.6.7.8')).toBe(false)
  })
  it('fails closed on unknown / missing IP when restricted', () => {
    expect(isIpAllowed(['1.2.3.4'], 'unknown')).toBe(false)
    expect(isIpAllowed(['1.2.3.4'], null)).toBe(false)
    expect(isIpAllowed(['1.2.3.4'], undefined)).toBe(false)
  })
})

describe('scopeAllowsWrite', () => {
  it('only READ_WRITE may write', () => {
    expect(scopeAllowsWrite('READ_WRITE')).toBe(true)
    expect(scopeAllowsWrite('READ')).toBe(false)
  })
})
