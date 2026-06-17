import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decryptTotpSecret, verifyTotpCode } from '@/lib/auth/totp'

const bodySchema = z.object({ code: z.string().length(6) })

// POST /api/auth/2fa/disable
// Requires a full authenticated session (not pending2fa).
// ADMIN users cannot disable 2FA — policy enforced here.
export async function POST(req: NextRequest) {
  const session = await auth()
  const user = session?.user as unknown as Record<string, unknown> | undefined
  if (!session || !user?.id || user.pending2fa) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  if (user.role === 'ADMIN') {
    return NextResponse.json(
      { error: 'Administrators must keep two-factor authentication enabled.' },
      { status: 403 },
    )
  }

  const body = bodySchema.safeParse(await req.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: 'A 6-digit code is required.' }, { status: 400 })
  }

  const userId = user.id as string
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
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    }),
  ])

  return NextResponse.json({ ok: true })
}
