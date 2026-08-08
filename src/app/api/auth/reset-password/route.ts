import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { hash } from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { hashResetToken, isResetTokenUsable } from '@/lib/auth/password-reset'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit-pure'

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
})

const INVALID = () => NextResponse.json(
  { error: 'This reset link is invalid or has expired. Please request a new one.' },
  { status: 400 },
)

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'))
  const { allowed } = await checkRateLimit(RATE_LIMITS.resetPassword, ip)
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

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

  if (!record || !isResetTokenUsable(record)) return INVALID()

  const passwordHash = await hash(password, 12)

  // One transaction, so the token is consumed if and only if the password is
  // actually replaced. Consuming first and updating separately meant a failure
  // between the two burned the reset link without changing anything — the user
  // locked out of the account and out of the link that was meant to fix it.
  //
  // Consumption stays conditional on usedAt being null, so a concurrent second
  // attempt still loses the race rather than resetting the password twice.
  //
  // The tokenVersion bump invalidates every existing JWT for this user: the next
  // server-side check reads the live version, finds a mismatch, and refuses.
  const changed = await prisma.$transaction(async tx => {
    const consumed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    })
    if (consumed.count === 0) return false

    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    })
    return true
  })

  if (!changed) return INVALID()

  return NextResponse.json({ ok: true })
}
