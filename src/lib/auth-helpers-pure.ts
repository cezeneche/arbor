// Pure session-security decision logic — no framework or DB dependencies, so it
// can be unit-tested in isolation. requireAuth() wires this to auth() + Prisma.

export type SessionSecurityCode =
  | 'TWO_FACTOR_REQUIRED'
  | 'ACCOUNT_GONE'
  | 'SESSION_REVOKED'
  | 'ADMIN_TWO_FACTOR_SETUP_REQUIRED'

export type SessionSecurityResult =
  | { ok: true }
  | { ok: false; code: SessionSecurityCode }

export interface SessionSecurityOptions {
  /** The 2FA enrolment endpoints themselves must stay reachable by an
   *  unenrolled admin, or they could never enrol. */
  exemptAdminTwoFactorSetup?: boolean
}

export function evaluateSessionSecurity(
  sessionUser: { pending2fa?: boolean; tokenVersion?: number },
  dbUser: { tokenVersion: number; role?: string; twoFactorEnabled?: boolean } | null,
  opts: SessionSecurityOptions = {},
): SessionSecurityResult {
  // 2FA gate first: a half-authenticated session should be sent to verify 2FA,
  // not bounced to a full re-login, even if its version is also stale.
  if (sessionUser.pending2fa === true) {
    return { ok: false, code: 'TWO_FACTOR_REQUIRED' }
  }

  if (!dbUser) {
    return { ok: false, code: 'ACCOUNT_GONE' }
  }

  if (dbUser.tokenVersion !== (sessionUser.tokenVersion ?? 0)) {
    return { ok: false, code: 'SESSION_REVOKED' }
  }

  // Mandatory admin 2FA, enforced at the API layer too — the portal layout's
  // redirect to /security-setup only covers page loads, not direct API calls.
  // Only applies when the caller supplied role/enrolment (backwards compatible).
  if (
    !opts.exemptAdminTwoFactorSetup &&
    dbUser.role === 'ADMIN' &&
    dbUser.twoFactorEnabled === false
  ) {
    return { ok: false, code: 'ADMIN_TWO_FACTOR_SETUP_REQUIRED' }
  }

  return { ok: true }
}
