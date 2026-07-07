// Module augmentation for the fields Arbor stores on the session/JWT. The auth
// callbacks (auth.config.ts / auth.ts) populate these from the User row; declaring
// them here lets routes read session.user.entityId etc. without unknown-casts.
import type { UserRole } from '@prisma/client'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      // Null for platform roles (VERIFIER, AUDITOR) that belong to no entity.
      entityId: string | null
      role: UserRole
      tokenVersion: number
      pending2fa?: boolean
      // Retains compatibility with legacy `session.user as Record<string, unknown>`
      // access; the named fields above still carry their precise types.
      [key: string]: unknown
    } & DefaultSessionUser
  }
}

// The default next-auth user shape (name/email/image) we still expose.
interface DefaultSessionUser {
  name?: string | null
  email?: string | null
  image?: string | null
}

declare module 'next-auth/jwt' {
  interface JWT {
    entityId?: string | null
    role?: UserRole
    tokenVersion?: number
    pending2fa?: boolean
  }
}
