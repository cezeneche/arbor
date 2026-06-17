import type { NextAuthConfig } from 'next-auth'

// Edge-safe auth config  -  no Prisma, no bcrypt.
// Used by middleware (proxy.ts). The full config (with adapter + provider) lives in auth.ts.
export const authConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const u = user as unknown as Record<string, unknown>
        if (u.pending2fa) {
          token.pending2fa = true
        } else {
          token.entityId = u.entityId as string
          token.role = u.role as string
          token.tokenVersion = u.tokenVersion as number
          token.pending2fa = undefined
        }
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.sub!
      const u = session.user as unknown as Record<string, unknown>
      u.entityId = token.entityId
      u.role = token.role
      u.tokenVersion = token.tokenVersion
      u.pending2fa = token.pending2fa ?? false
      return session
    },
  },
  providers: [],
} satisfies NextAuthConfig
