import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import {
  evaluateSessionSecurity,
  type SessionSecurityCode,
  type SessionSecurityOptions,
} from '@/lib/auth-helpers-pure'
import { getSessionUser } from '@/lib/session'

const unauthorised = (reason: string, code: string, status = 401) => ({
  session: null,
  response: NextResponse.json({ error: reason, code }, { status }),
})

const SECURITY_MESSAGES: Record<SessionSecurityCode, string> = {
  TWO_FACTOR_REQUIRED: 'Two-factor verification required',
  ACCOUNT_GONE: 'Account no longer exists',
  ACCOUNT_DISABLED: 'This account has been deactivated.',
  SESSION_REVOKED: 'Session has been revoked. Please sign in again.',
  ADMIN_TWO_FACTOR_SETUP_REQUIRED:
    'Administrators must enable two-factor authentication before using the API.',
}

/** Resolves a live session: the JWT proves who signed in, the DB decides whether
 *  that is still true. Role and entityId come back from the DB, never the token,
 *  so a demotion or a tenant move takes effect on the next request rather than at
 *  JWT expiry. Returns null when the session must be rejected.
 */
export async function resolveLiveSession(opts: SessionSecurityOptions = {}): Promise<
  | { ok: true; session: Session }
  | { ok: false; code: SessionSecurityCode | 'AUTH_REQUIRED' }
> {
  const session = await auth()
  if (!session?.user) return { ok: false, code: 'AUTH_REQUIRED' }

  const user = getSessionUser(session)
  const userId = user.id as string | undefined

  // Look up the live record so a password reset, forced logout, deprovisioning or
  // role change actually invalidates old JWTs, and re-check the 2FA gates
  // server-side (the middleware/layout redirects are bypassed on direct calls).
  const dbUser = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: {
          tokenVersion: true,
          isActive: true,
          role: true,
          entityId: true,
          twoFactorEnabled: true,
        },
      })
    : null

  const verdict = evaluateSessionSecurity(
    { pending2fa: user.pending2fa, tokenVersion: user.tokenVersion },
    dbUser,
    opts,
  )
  if (!verdict.ok) return { ok: false, code: verdict.code }

  // Authorisation reads role/entityId from this session object, so overwrite the
  // token's copies with the live ones before handing it back.
  const live = {
    ...session,
    user: { ...session.user, role: dbUser!.role, entityId: dbUser!.entityId },
  } as Session

  return { ok: true, session: live }
}

export async function requireAuth(opts: SessionSecurityOptions = {}) {
  const resolved = await resolveLiveSession(opts)

  if (!resolved.ok) {
    if (resolved.code === 'AUTH_REQUIRED') {
      return unauthorised('Unauthorised', 'AUTH_REQUIRED')
    }
    // Enrolment is a policy gate on an otherwise-valid session → 403, not 401.
    const status =
      resolved.code === 'ADMIN_TWO_FACTOR_SETUP_REQUIRED' || resolved.code === 'ACCOUNT_DISABLED'
        ? 403
        : 401
    return unauthorised(SECURITY_MESSAGES[resolved.code], resolved.code, status)
  }

  return { session: resolved.session, response: null }
}

/** Requires an authenticated session with any write-capable role.
 *  Blocks VIEWER — read-only role cannot upload, confirm, or create records.
 */
export async function requireWriteAccess() {
  const { session, response } = await requireAuth()
  if (!session) return { session: null, response: response! }
  const role = getSessionUser(session).role
  if (role === 'VIEWER') {
    return {
      session: null,
      response: NextResponse.json(
        { error: 'Forbidden — VIEWER role is read-only', code: 'FORBIDDEN' },
        { status: 403 },
      ),
    }
  }
  return { session, response: null }
}

/** Requires an authenticated session AND the ADMIN role.
 *  Returns the session on success, or a 401/403 response on failure.
 */
export async function requireAdmin() {
  const { session, response } = await requireAuth()
  if (!session) return { session: null, response: response! }
  const role = getSessionUser(session).role
  if (role !== 'ADMIN') {
    return {
      session: null,
      response: NextResponse.json(
        { error: 'Forbidden — ADMIN role required', code: 'FORBIDDEN' },
        { status: 403 }
      ),
    }
  }
  return { session, response: null }
}

/** Requires an authenticated platform operator (User.isPlatformAdmin).
 *  Gates cross-tenant /api/admin surfaces — a tenant-level ADMIN governs only
 *  their own entity and must NOT reach these. The flag is read fresh from the DB
 *  (not the JWT) so it is revocable immediately. Returns the session on success,
 *  or a 401/403 response on failure.
 */
export async function requirePlatformAdmin() {
  const { session, response } = await requireAuth()
  if (!session) return { session: null, response: response! }
  const userId = getSessionUser(session).id
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPlatformAdmin: true },
  })
  if (!dbUser?.isPlatformAdmin) {
    return {
      session: null,
      response: NextResponse.json(
        { error: 'Forbidden — platform operator access required', code: 'FORBIDDEN' },
        { status: 403 },
      ),
    }
  }
  return { session, response: null }
}

/** requires an authenticated session with the VERIFIER role.
 *  Verifiers belong to no entity; they act on assigned verification packages.
 */
export async function requireVerifier() {
  const { session, response } = await requireAuth()
  if (!session) return { session: null, response: response! }
  const role = getSessionUser(session).role
  if (role !== 'VERIFIER') {
    return {
      session: null,
      response: NextResponse.json(
        { error: 'Forbidden — VERIFIER role required', code: 'FORBIDDEN' },
        { status: 403 },
      ),
    }
  }
  return { session, response: null }
}

/** requires an authenticated AUDITOR with non-expired AuditorAccess to the entity. */
export async function requireAuditorAccess(entityId: string) {
  const { session, response } = await requireAuth()
  if (!session) return { session: null, response: response! }
  const role = getSessionUser(session).role
  if (role !== 'AUDITOR') {
    return {
      session: null,
      response: NextResponse.json(
        { error: 'Forbidden — AUDITOR role required', code: 'FORBIDDEN' },
        { status: 403 },
      ),
    }
  }
  const userId = getSessionUser(session).id
  const access = await prisma.auditorAccess.findFirst({
    where: { auditorUserId: userId, entityId, expiresAt: { gt: new Date() } },
  })
  if (!access) {
    return {
      session: null,
      response: NextResponse.json(
        { error: 'Forbidden — no active auditor access for this entity', code: 'FORBIDDEN' },
        { status: 403 },
      ),
    }
  }
  return { session, response: null, access }
}
