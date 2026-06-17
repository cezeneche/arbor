import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'
import { evaluateSessionSecurity, type SessionSecurityCode } from '@/lib/auth-helpers-pure'

const unauthorised = (reason: string, code: string) => ({
  session: null,
  response: NextResponse.json({ error: reason, code }, { status: 401 }),
})

const SECURITY_MESSAGES: Record<SessionSecurityCode, string> = {
  TWO_FACTOR_REQUIRED: 'Two-factor verification required',
  ACCOUNT_GONE: 'Account no longer exists',
  SESSION_REVOKED: 'Session has been revoked. Please sign in again.',
}

export async function requireAuth() {
  const session = await auth()
  if (!session?.user) {
    return unauthorised('Unauthorised', 'AUTH_REQUIRED')
  }

  const user = session.user as Record<string, unknown>
  const userId = user.id as string | undefined

  // Look up the live tokenVersion so a password reset / forced logout actually
  // invalidates old JWTs, and re-check the 2FA gate server-side (defence in depth:
  // the middleware redirect is bypassed on API routes exempted from it).
  const dbUser = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } })
    : { tokenVersion: 0 }

  const verdict = evaluateSessionSecurity(
    { pending2fa: user.pending2fa as boolean | undefined, tokenVersion: user.tokenVersion as number | undefined },
    dbUser,
  )

  if (!verdict.ok) {
    return unauthorised(SECURITY_MESSAGES[verdict.code], verdict.code)
  }

  return { session, response: null }
}

/** Requires an authenticated session with any write-capable role.
 *  Blocks VIEWER — read-only role cannot upload, confirm, or create records.
 */
export async function requireWriteAccess() {
  const { session, response } = await requireAuth()
  if (!session) return { session: null, response: response! }
  const role = (session.user as Record<string, unknown>).role as string
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
  const role = (session.user as Record<string, unknown>).role as string
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
