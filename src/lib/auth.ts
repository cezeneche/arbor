import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { compare } from 'bcryptjs'
import { authConfig } from '@/lib/auth.config'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit-pure'
import { verifySsoToken } from '@/lib/sso/sso-token'

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    // Gap 10 — SSO sign-in: a one-time signed token minted by the WorkOS callback.
    Credentials({
      id: 'workos',
      name: 'WorkOS SSO',
      credentials: { token: { label: 'Token', type: 'text' } },
      async authorize(credentials) {
        const token = typeof credentials?.token === 'string' ? credentials.token : null
        if (!token) return null
        const userId = verifySsoToken(token)
        if (!userId) return null
        const user = await prisma.user.findUnique({ where: { id: userId } })
        // SSO users skip TOTP (their IdP enforces MFA), but must be active.
        if (!user || !user.isActive) return null
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
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        const parsed = z.object({
          email: z.string().email(),
          password: z.string().min(8),
        }).safeParse(credentials)

        if (!parsed.success) return null

        // Anti-brute-force: cap login attempts per source IP. Returns null on
        // exceed so the attacker can't distinguish rate-limiting from a bad password.
        const ip = getClientIp(
          request?.headers?.get('x-forwarded-for') ?? null,
          request?.headers?.get('x-real-ip') ?? null,
        )
        const { allowed } = await checkRateLimit(RATE_LIMITS.login, ip)
        if (!allowed) return null

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
          include: { entity: true },
        })

        if (!user || !user.passwordHash) return null
        // Gap 10 — deprovisioned (SCIM-disabled) accounts cannot sign in.
        if (!user.isActive) return null
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
