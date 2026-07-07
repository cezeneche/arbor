import type { Session } from 'next-auth'
import type { UserRole } from '@prisma/client'

// Typed view over session.user. Backed by the next-auth module augmentation
// (src/types/next-auth.d.ts), so callers stop reaching through
// `(session.user as Record<string, unknown>)`.
export interface SessionUser {
  id: string
  entityId: string | null
  role: UserRole
  tokenVersion: number
  pending2fa?: boolean
  email?: string | null
  name?: string | null
}

export function getSessionUser(session: Session): SessionUser {
  return session.user as SessionUser
}
