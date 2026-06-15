import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function requireAuth() {
  const session = await auth()
  if (!session?.user) {
    return {
      session: null,
      response: NextResponse.json(
        { error: 'Unauthorised', code: 'AUTH_REQUIRED' },
        { status: 401 }
      ),
    }
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
