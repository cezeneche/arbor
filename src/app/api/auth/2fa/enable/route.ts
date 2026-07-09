import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { decryptTotpSecret, verifyTotpCode, generateRecoveryCodes, hashRecoveryCode } from '@/lib/auth/totp'

const bodySchema = z.object({ code: z.string().length(6) })

// POST /api/auth/2fa/enable
// Verifies the first TOTP code, marks 2FA enabled, generates recovery codes.
// Returns plaintext recovery codes — shown once, never again.
// requireAuth() enforces a full (non-pending2fa) session and re-checks tokenVersion.
export async function POST(req: NextRequest) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const body = bodySchema.safeParse(await req.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: 'A 6-digit code is required.' }, { status: 400 })
  }

  const userId = getSessionUser(session).id
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorSecret: true, twoFactorEnabled: true },
  })

  if (!dbUser?.twoFactorSecret) {
    return NextResponse.json({ error: 'No secret found. Please run setup first.' }, { status: 400 })
  }
  if (dbUser.twoFactorEnabled) {
    return NextResponse.json({ error: '2FA is already enabled.' }, { status: 409 })
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

  const plainCodes = generateRecoveryCodes()

  await prisma.$transaction([
    prisma.totpRecoveryCode.deleteMany({ where: { userId } }),
    prisma.totpRecoveryCode.createMany({
      data: plainCodes.map(code => ({ userId, codeHash: hashRecoveryCode(code) })),
    }),
    prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    }),
  ])

  return NextResponse.json({ recoveryCodes: plainCodes })
}
