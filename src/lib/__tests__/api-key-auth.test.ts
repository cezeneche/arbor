// Unit tests for API key authentication logic
// These tests exercise the pure validation paths that don't require DB access

import { validateAuthHeader } from '../api-key-auth-pure'

describe('validateAuthHeader', () => {
  it('null header → unauthorized', () => {
    const result = validateAuthHeader(null)
    expect(result.authorized).toBe(false)
    expect(result.reason).toContain('Missing')
  })

  it('header without Bearer prefix → unauthorized', () => {
    const result = validateAuthHeader('Basic abc123')
    expect(result.authorized).toBe(false)
    expect(result.reason).toContain('malformed')
  })

  it('Bearer with empty key → unauthorized', () => {
    const result = validateAuthHeader('Bearer ')
    expect(result.authorized).toBe(false)
    expect(result.reason).toContain('Empty')
  })

  it('valid Bearer format → returns raw key', () => {
    const result = validateAuthHeader('Bearer sk-test-key-12345')
    expect(result.rawKey).toBe('sk-test-key-12345')
    expect(result.reason).toBeNull()
  })

  it('Bearer with whitespace-only key → unauthorized', () => {
    const result = validateAuthHeader('Bearer   ')
    expect(result.authorized).toBe(false)
  })
})
