import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decryptTotpSecret, verifyTotpCode, verifyRecoveryCode, hashRecoveryCode } from '@/lib/auth/totp'
import { generateVerificationNonce } from '@/lib/auth/two-factor-nonce'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

const bodySchema = z.object({
  code: z.string().min(1),
  isRecovery: z.boolean().optional().default(false),
})

// POST /api/auth/2fa/complete
// Called from /2fa-verify during the login flow.
// Requires a pending2fa session. Verifies TOTP or recovery code.
// On success the client calls update({ totpVerified: true }) to upgrade the JWT.
export async function POST(req: NextRequest) {
  const session = await auth()
  const user = session?.user as unknown as Record<string, unknown> | undefined
  if (!session || !user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  if (!user.pending2fa) {
    return NextResponse.json({ error: 'No 2FA challenge is active.' }, { status: 400 })
  }

  // Anti-brute-force: cap verification attempts per user (6-digit TOTP / recovery codes).
  // This is the only gate on a 6-digit code, so fail closed if the limiter is down.
  const { allowed } = await checkRateLimit(RATE_LIMITS.twoFactor, user.id as string, { failMode: 'closed' })
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429 },
    )
  }

  const body = bodySchema.safeParse(await req.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const userId = user.id as string
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorSecret: true, twoFactorEnabled: true },
  })

  if (!dbUser?.twoFactorEnabled || !dbUser.twoFactorSecret) {
    return NextResponse.json({ error: '2FA is not configured for this account.' }, { status: 400 })
  }

  const { code, isRecovery } = body.data

  // Persist a single-use nonce and hand the raw value back. The client replays it
  // via update({ totpVerifiedNonce }); the jwt callback consumes it to upgrade the
  // session. This is the only server-verifiable proof the challenge was passed.
  async function issueVerificationNonce(): Promise<string> {
    const { nonce, nonceHash, expiresAt } = generateVerificationNonce()
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorVerifiedNonce: nonceHash, twoFactorVerifiedExpires: expiresAt },
    })
    return nonce
  }

  if (isRecovery) {
    // Find a matching unused recovery code
    const all = await prisma.totpRecoveryCode.findMany({
      where: { userId, usedAt: null },
    })
    const match = all.find(r => verifyRecoveryCode(r.codeHash, code))
    if (!match) {
      return NextResponse.json({ error: 'Recovery code is invalid or has already been used.' }, { status: 400 })
    }
    // Atomically consume it
    const consumed = await prisma.totpRecoveryCode.updateMany({
      where: { id: match.id, usedAt: null },
      data: { usedAt: new Date() },
    })
    if (consumed.count === 0) {
      return NextResponse.json({ error: 'Recovery code is invalid or has already been used.' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, nonce: await issueVerificationNonce() })
  }

  // Standard TOTP code
  let secret: string
  try {
    secret = decryptTotpSecret(dbUser.twoFactorSecret)
  } catch {
    return NextResponse.json({ error: 'Failed to read 2FA secret.' }, { status: 500 })
  }

  if (!verifyTotpCode(secret, code)) {
    return NextResponse.json({ error: 'Code is incorrect or has expired.' }, { status: 400 })
  }

  return NextResponse.json({ ok: true, nonce: await issueVerificationNonce() })
}
