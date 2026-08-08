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
  // exempt: an unenrolled admin must be able to reach enable to finish enrolling.
  const { session, response } = await requireAuth({ exemptAdminTwoFactorSetup: true })
  if (!session) return response!

  const body = bodySchema.safeParse(await req.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: 'A 6-digit code is required.' }, { status: 400 })
  }

  const userId = getSessionUser(session).id
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorPendingSecret: true, twoFactorEnabled: true },
  })

  // Only a pending secret can be promoted. An already-enabled account gets here
  // only after /2fa/setup re-authenticated the caller, so re-enrolment (new phone)
  // is allowed — it just has to be confirmed by a code from the new device.
  if (!dbUser?.twoFactorPendingSecret) {
    return NextResponse.json({ error: 'No secret found. Please run setup first.' }, { status: 400 })
  }

  let secret: string
  try {
    secret = decryptTotpSecret(dbUser.twoFactorPendingSecret)
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
    // Promote pending → active in the same transaction that enables the gate, so
    // the account is never left enabled against a secret nobody holds.
    prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: dbUser.twoFactorPendingSecret,
        twoFactorPendingSecret: null,
      },
    }),
  ])

  return NextResponse.json({ recoveryCodes: plainCodes })
}
