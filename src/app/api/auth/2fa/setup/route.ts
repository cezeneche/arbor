import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateTotpSecret, getTotpUri, encryptTotpSecret } from '@/lib/auth/totp'
import QRCode from 'qrcode'

// POST /api/auth/2fa/setup
// Generates a TOTP secret, stores it (encrypted, not yet enabled), returns QR code.
// Requires a full authenticated session (not pending2fa).
export async function POST() {
  const session = await auth()
  const user = session?.user as unknown as Record<string, unknown> | undefined
  if (!session || !user?.id || user.pending2fa) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const userId = user.id as string
  const email = getSessionUser(session).email as string ?? ''

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
