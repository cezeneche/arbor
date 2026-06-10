import type { NextAuthConfig } from 'next-auth'

// Edge-safe auth config  -  no Prisma, no bcrypt.
// Used by middleware. The full config (with adapter + provider) lives in auth.ts.
export const authConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.entityId = (user as unknown as Record<string, unknown>).entityId as string
        token.role = (user as unknown as Record<string, unknown>).role as string
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.sub!
      ;(session.user as unknown as Record<string, unknown>).entityId = token.entityId
      ;(session.user as unknown as Record<string, unknown>).role = token.role
      return session
    },
  },
  providers: [],
} satisfies NextAuthConfig
