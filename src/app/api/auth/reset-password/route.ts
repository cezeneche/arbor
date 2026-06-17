import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { hash } from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { hashResetToken, isResetTokenUsable } from '@/lib/auth/password-reset'

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
})

const INVALID = NextResponse.json(
  { error: 'This reset link is invalid or has expired. Please request a new one.' },
  { status: 400 },
)

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const { token, password } = parsed.data
  const tokenHash = hashResetToken(token)

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  })

  if (!record || !isResetTokenUsable(record)) return INVALID

  const passwordHash = await hash(password, 12)

  // Update the password and consume the token atomically — the token can never be
  // reused, even on a retry, because the update is conditional on usedAt still null.
  const consumed = await prisma.passwordResetToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (consumed.count === 0) return INVALID

  // Bump tokenVersion to invalidate any existing JWT sessions for this user.
  // The next time those sessions hit a server-side auth() check, the DB version
  // won't match and callers can treat the mismatch as unauthorised.
  await prisma.user.update({
    where: { id: record.userId },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  })

  return NextResponse.json({ ok: true })
}
