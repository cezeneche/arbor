import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { generateTotpSecret, getTotpUri, encryptTotpSecret } from '@/lib/auth/totp'
import QRCode from 'qrcode'

// POST /api/auth/2fa/setup
// Generates a TOTP secret, stores it (encrypted, not yet enabled), returns QR code.
// requireAuth() enforces a full (non-pending2fa) session AND re-checks tokenVersion
// revocation and account status server-side — raw auth() skipped both.
export async function POST() {
  // exempt: an unenrolled admin must be able to reach setup to enrol at all.
  const { session, response } = await requireAuth({ exemptAdminTwoFactorSetup: true })
  if (!session) return response!

  const sessionUser = getSessionUser(session)
  const userId = sessionUser.id
  const email = (sessionUser.email as string) ?? ''

  const secret = generateTotpSecret()
  const encrypted = encryptTotpSecret(secret)

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: encrypted },
  })

  const uri = getTotpUri(secret, email)
  const qrDataUrl = await QRCode.toDataURL(uri)

  return NextResponse.json({ qrDataUrl, secret, uri })
}
