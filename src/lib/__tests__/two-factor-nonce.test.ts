import {
  generateVerificationNonce,
  hashNonce,
  isNonceValid,
  TWO_FACTOR_NONCE_TTL_MS,
} from '@/lib/auth/two-factor-nonce'

describe('two-factor verification nonce', () => {
  it('generates a nonce whose stored hash matches the raw value', () => {
    const g = generateVerificationNonce()
    expect(g.nonce).toHaveLength(43) // 32 bytes base64url, unpadded
    expect(g.nonceHash).toBe(hashNonce(g.nonce))
    expect(g.nonceHash).not.toBe(g.nonce)
  })

  it('accepts a matching, unexpired nonce', () => {
    const now = new Date('2026-07-07T12:00:00Z')
    const g = generateVerificationNonce(now)
    expect(isNonceValid({ nonceHash: g.nonceHash, expiresAt: g.expiresAt }, g.nonce, now)).toBe(true)
  })

  it('rejects a nonce that does not match the stored hash', () => {
    const g = generateVerificationNonce()
    expect(isNonceValid({ nonceHash: g.nonceHash, expiresAt: g.expiresAt }, 'forged-nonce')).toBe(false)
  })

  it('rejects an expired nonce even when the hash matches', () => {
    const now = new Date('2026-07-07T12:00:00Z')
    const g = generateVerificationNonce(now)
    const later = new Date(now.getTime() + TWO_FACTOR_NONCE_TTL_MS + 1)
    expect(isNonceValid({ nonceHash: g.nonceHash, expiresAt: g.expiresAt }, g.nonce, later)).toBe(false)
  })

  it('rejects when the stored hash has been consumed (null)', () => {
    const g = generateVerificationNonce()
    expect(isNonceValid({ nonceHash: null, expiresAt: g.expiresAt }, g.nonce)).toBe(false)
    expect(isNonceValid({ nonceHash: g.nonceHash, expiresAt: null }, g.nonce)).toBe(false)
  })
})
