import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { generateResetToken } from '@/lib/auth/password-reset'
import { sendPasswordResetEmail } from '@/lib/auth/reset-email'

const schema = z.object({ email: z.string().email() })

// Always responds 200 with the same body, whether or not the email is registered,
// so an attacker cannot use this endpoint to discover which emails have accounts.
const GENERIC_OK = NextResponse.json({ ok: true })

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return GENERIC_OK

  const email = parsed.data.email.toLowerCase()

  try {
    const user = await prisma.user.findUnique({ where: { email } })
    // Only issue a reset for an account that has a password set.
    if (user && user.passwordHash) {
      // Invalidate any earlier unused tokens for this user.
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } })

      const { token, tokenHash, expiresAt } = generateResetToken()
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      })

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
      const resetUrl = `${appUrl}/reset-password?token=${token}`
      await sendPasswordResetEmail(user.email, user.name, resetUrl)
    }
  } catch {
    // Swallow errors so the response is identical regardless of internal state.
  }

  return NextResponse.json({ ok: true })
}
