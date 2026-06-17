import { evaluateSessionSecurity } from '../auth-helpers-pure'

describe('evaluateSessionSecurity', () => {
  it('accepts a clean session whose tokenVersion matches the DB', () => {
    const result = evaluateSessionSecurity(
      { pending2fa: false, tokenVersion: 3 },
      { tokenVersion: 3 },
    )
    expect(result.ok).toBe(true)
  })

  it('rejects a session still pending the 2FA challenge', () => {
    const result = evaluateSessionSecurity(
      { pending2fa: true, tokenVersion: 3 },
      { tokenVersion: 3 },
    )
    expect(result).toEqual({ ok: false, code: 'TWO_FACTOR_REQUIRED' })
  })

  it('rejects when the user no longer exists in the DB', () => {
    const result = evaluateSessionSecurity(
      { pending2fa: false, tokenVersion: 3 },
      null,
    )
    expect(result).toEqual({ ok: false, code: 'ACCOUNT_GONE' })
  })

  it('rejects when the DB tokenVersion has moved ahead (password reset / forced logout)', () => {
    const result = evaluateSessionSecurity(
      { pending2fa: false, tokenVersion: 3 },
      { tokenVersion: 4 },
    )
    expect(result).toEqual({ ok: false, code: 'SESSION_REVOKED' })
  })

  it('treats a missing session tokenVersion as 0', () => {
    expect(evaluateSessionSecurity({ pending2fa: false }, { tokenVersion: 0 })).toEqual({ ok: true })
    expect(evaluateSessionSecurity({ pending2fa: false }, { tokenVersion: 1 })).toEqual({
      ok: false,
      code: 'SESSION_REVOKED',
    })
  })

  it('checks the 2FA gate before the version gate', () => {
    // Pending 2FA AND a stale version — 2FA must win so the user is sent to verify, not re-login
    const result = evaluateSessionSecurity(
      { pending2fa: true, tokenVersion: 1 },
      { tokenVersion: 9 },
    )
    expect(result).toEqual({ ok: false, code: 'TWO_FACTOR_REQUIRED' })
  })
})
