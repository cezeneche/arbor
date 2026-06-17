import {
  generateResetToken,
  hashResetToken,
  isResetTokenUsable,
  RESET_TOKEN_TTL_MS,
} from '../password-reset'

describe('generateResetToken', () => {
  it('returns a token whose hash matches hashResetToken', () => {
    const { token, tokenHash } = generateResetToken()
    expect(token.length).toBeGreaterThan(20) // high-entropy, URL-safe
    expect(tokenHash).toBe(hashResetToken(token))
  })

  it('stores the hash, never the raw token', () => {
    const { token, tokenHash } = generateResetToken()
    expect(tokenHash).not.toBe(token)
  })

  it('sets expiry to now + TTL', () => {
    const now = new Date('2026-06-17T12:00:00.000Z')
    const { expiresAt } = generateResetToken(now)
    expect(expiresAt.getTime()).toBe(now.getTime() + RESET_TOKEN_TTL_MS)
  })

  it('produces a unique token on each call', () => {
    const a = generateResetToken()
    const b = generateResetToken()
    expect(a.token).not.toBe(b.token)
    expect(a.tokenHash).not.toBe(b.tokenHash)
  })
})

describe('hashResetToken', () => {
  it('is deterministic for the same input', () => {
    expect(hashResetToken('abc')).toBe(hashResetToken('abc'))
  })

  it('differs for different inputs', () => {
    expect(hashResetToken('abc')).not.toBe(hashResetToken('abd'))
  })
})

describe('isResetTokenUsable', () => {
  const now = new Date('2026-06-17T12:00:00.000Z')

  it('is usable when unexpired and unused', () => {
    const future = new Date(now.getTime() + 60_000)
    expect(isResetTokenUsable({ expiresAt: future, usedAt: null }, now)).toBe(true)
  })

  it('is not usable when expired', () => {
    const past = new Date(now.getTime() - 1)
    expect(isResetTokenUsable({ expiresAt: past, usedAt: null }, now)).toBe(false)
  })

  it('is not usable when already used', () => {
    const future = new Date(now.getTime() + 60_000)
    expect(isResetTokenUsable({ expiresAt: future, usedAt: new Date(now) }, now)).toBe(false)
  })

  it('is not usable exactly at expiry', () => {
    expect(isResetTokenUsable({ expiresAt: now, usedAt: null }, now)).toBe(false)
  })
})
