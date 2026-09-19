import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { sendEmailVerification } from '@/lib/auth/verify-email-send'

export async function POST() {
  const { session, response } = await requireAuth()
  if (!session) return response!
  const userId = getSessionUser(session).id as string

  const { allowed } = await checkRateLimit(RATE_LIMITS.forgotPassword, `verify:${userId}`)
  if (!allowed) return NextResponse.json({ error: 'Please wait before asking again.' }, { status: 429 })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, emailVerifiedAt: true },
  })
  if (!user) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
  if (user.emailVerifiedAt) return NextResponse.json({ ok: true, alreadyVerified: true })

  await sendEmailVerification(user)
  return NextResponse.json({ ok: true })
}
