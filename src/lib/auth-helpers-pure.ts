// Pure session-security decision logic — no framework or DB dependencies, so it
// can be unit-tested in isolation. requireAuth() wires this to auth() + Prisma.

export type SessionSecurityCode = 'TWO_FACTOR_REQUIRED' | 'ACCOUNT_GONE' | 'SESSION_REVOKED'

export type SessionSecurityResult =
  | { ok: true }
  | { ok: false; code: SessionSecurityCode }

export function evaluateSessionSecurity(
  sessionUser: { pending2fa?: boolean; tokenVersion?: number },
  dbUser: { tokenVersion: number } | null,
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

  return { ok: true }
}
