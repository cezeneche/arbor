import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { compare } from 'bcryptjs'
import { authConfig } from '@/lib/auth.config'

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = z.object({
          email: z.string().email(),
          password: z.string().min(8),
        }).safeParse(credentials)

        if (!parsed.success) return null

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          include: { entity: true },
        })

        if (!user || !user.passwordHash) return null
        const valid = await compare(parsed.data.password, user.passwordHash)
        if (!valid) return null

        // If 2FA is enabled, return a partial session that signals the challenge step.
        // The JWT callback will set pending2fa: true; the proxy redirects to /2fa-verify.
        if (user.twoFactorEnabled) {
          return {
            id: user.id,
            email: '',
            name: '',
            pending2fa: true,
          } as unknown as ReturnType<typeof Object.create>
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          entityId: user.entityId,
          role: user.role,
          tokenVersion: user.tokenVersion,
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Override jwt to support the 2FA upgrade trigger from the client.
    // When the /2fa-verify page calls update({ totpVerified: true }),
    // this callback re-fetches the user from DB and upgrades the token.
    async jwt({ token, user, trigger, session }) {
      // Initial sign-in — delegate to edge-safe config logic
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
        return token
      }

      // 2FA upgrade: client called update({ totpVerified: true }) after verifying code
      if (trigger === 'update' && token.pending2fa && (session as Record<string, unknown>)?.totpVerified) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub! },
          select: { entityId: true, role: true, tokenVersion: true },
        })
        if (dbUser) {
          token.entityId = dbUser.entityId
          token.role = dbUser.role
          token.tokenVersion = dbUser.tokenVersion
          token.pending2fa = undefined
        }
      }

      return token
    },
  },
})
