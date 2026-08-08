import { redirect } from 'next/navigation'
import type { Session } from 'next-auth'
import { resolveLiveSession } from '@/lib/auth-helpers'
import type { SessionSecurityOptions } from '@/lib/auth-helpers-pure'

// Server-rendered pages need the same liveness checks the API routes get.
// Raw auth() only decodes the JWT, so a deactivated user, a revoked session
// (password reset / forced logout) or a demoted role kept working until the
// token expired. requirePageSession() re-reads the user on every render and
// hands back a session whose role and entityId come from the database.
export async function requirePageSession(opts: SessionSecurityOptions = {}): Promise<Session> {
  const resolved = await resolveLiveSession(opts)
  if (resolved.ok) return resolved.session

  switch (resolved.code) {
    case 'TWO_FACTOR_REQUIRED':
      redirect('/2fa-verify')
    case 'ADMIN_TWO_FACTOR_SETUP_REQUIRED':
      redirect('/security-setup')
    case 'ACCOUNT_DISABLED':
      redirect('/login?error=account_disabled')
    case 'SESSION_REVOKED':
      redirect('/login?error=session_revoked')
    default:
      redirect('/login')
  }
}
