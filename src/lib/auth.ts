import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { compare } from 'bcryptjs'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
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

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          entityId: user.entityId,
          role: user.role,
        }
      },
    }),
  ],
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
})
