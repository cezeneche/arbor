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

describe('evaluateSessionSecurity — deprovisioning gate', () => {
  const base = { pending2fa: false, tokenVersion: 1 }

  // A SCIM deprovision / manual deactivation flips isActive but does not bump
  // tokenVersion, so without this gate the existing JWT keeps working until expiry.
  it('rejects a deactivated account even when the version still matches', () => {
    expect(evaluateSessionSecurity(base, { tokenVersion: 1, isActive: false })).toEqual({
      ok: false,
      code: 'ACCOUNT_DISABLED',
    })
  })

  it('accepts an active account', () => {
    expect(evaluateSessionSecurity(base, { tokenVersion: 1, isActive: true })).toEqual({ ok: true })
  })

  it('deactivation outranks the admin enrolment gate', () => {
    const result = evaluateSessionSecurity(base, {
      tokenVersion: 1,
      isActive: false,
      role: 'ADMIN',
      twoFactorEnabled: false,
    })
    expect(result).toEqual({ ok: false, code: 'ACCOUNT_DISABLED' })
  })

  it('a pending-2FA session on a deactivated account is still rejected as disabled', () => {
    // The half-authenticated session must not be completable after deprovisioning.
    const result = evaluateSessionSecurity(
      { pending2fa: true, tokenVersion: 1 },
      { tokenVersion: 1, isActive: false },
    )
    expect(result).toEqual({ ok: false, code: 'ACCOUNT_DISABLED' })
  })

  it('callers that do not pass isActive keep the old behaviour', () => {
    expect(evaluateSessionSecurity(base, { tokenVersion: 1 })).toEqual({ ok: true })
  })
})

describe('evaluateSessionSecurity — admin 2FA enrolment gate', () => {
  const base = { pending2fa: false, tokenVersion: 1 }

  it('rejects an ADMIN who has not enrolled 2FA (API-level gate, not just the page redirect)', () => {
    const result = evaluateSessionSecurity(base, { tokenVersion: 1, role: 'ADMIN', twoFactorEnabled: false })
    expect(result).toEqual({ ok: false, code: 'ADMIN_TWO_FACTOR_SETUP_REQUIRED' })
  })

  it('accepts an ADMIN with 2FA enrolled', () => {
    expect(evaluateSessionSecurity(base, { tokenVersion: 1, role: 'ADMIN', twoFactorEnabled: true })).toEqual({ ok: true })
  })

  it('does not gate non-admin roles on enrolment', () => {
    expect(evaluateSessionSecurity(base, { tokenVersion: 1, role: 'CONTRIBUTOR', twoFactorEnabled: false })).toEqual({ ok: true })
  })

  it('exemptAdminTwoFactorSetup allows the enrolment endpoints themselves through', () => {
    const result = evaluateSessionSecurity(
      base,
      { tokenVersion: 1, role: 'ADMIN', twoFactorEnabled: false },
      { exemptAdminTwoFactorSetup: true },
    )
    expect(result).toEqual({ ok: true })
  })

  it('callers that do not pass role/twoFactorEnabled keep the old behaviour', () => {
    expect(evaluateSessionSecurity(base, { tokenVersion: 1 })).toEqual({ ok: true })
  })
})
