import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { decryptTotpSecret, verifyTotpCode } from '@/lib/auth/totp'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

const bodySchema = z.object({ code: z.string().length(6) })

// POST /api/auth/2fa/disable
// requireAuth() enforces a full (non-pending2fa) session and re-checks tokenVersion.
// ADMIN users cannot disable 2FA — policy enforced here.
export async function POST(req: NextRequest) {
  const { session, response } = await requireAuth()
  if (!session) return response!
  const sessionUser = getSessionUser(session)

  if (sessionUser.role === 'ADMIN') {
    return NextResponse.json(
      { error: 'Administrators must keep two-factor authentication enabled.' },
      { status: 403 },
    )
  }

  const userId = sessionUser.id

  // Disabling verifies a 6-digit TOTP code, so it needs the same brute-force gate
  // as the login challenge. Fail closed if the limiter is unavailable.
  const { allowed } = await checkRateLimit(RATE_LIMITS.twoFactor, userId, { failMode: 'closed' })
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429 },
    )
  }

  const body = bodySchema.safeParse(await req.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: 'A 6-digit code is required.' }, { status: 400 })
  }
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorSecret: true, twoFactorEnabled: true },
  })

  if (!dbUser?.twoFactorEnabled || !dbUser.twoFactorSecret) {
    return NextResponse.json({ error: '2FA is not enabled on this account.' }, { status: 400 })
  }

  let secret: string
  try {
    secret = decryptTotpSecret(dbUser.twoFactorSecret)
  } catch {
    return NextResponse.json({ error: 'Failed to read 2FA secret.' }, { status: 500 })
  }

  if (!verifyTotpCode(secret, body.data.code)) {
    return NextResponse.json({ error: 'Code is incorrect or has expired.' }, { status: 400 })
  }

  await prisma.$transaction([
    prisma.totpRecoveryCode.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorPendingSecret: null },
    }),
  ])

  return NextResponse.json({ ok: true })
}
