import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithCode } from '@/lib/sso/workos'
import { mintSsoToken } from '@/lib/sso/sso-token'

// Gap 10 — WorkOS callback. Exchanges the code, auto-provisions the user against
// the entity bound to the WorkOS organisation, then hands a one-time token to the
// client which completes NextAuth sign-in.
export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/login?error=sso_no_code', appUrl))

  let profile
  try {
    profile = await authenticateWithCode(code)
  } catch {
    return NextResponse.redirect(new URL('/login?error=sso_exchange_failed', appUrl))
  }

  if (!profile.email || !profile.organizationId) {
    return NextResponse.redirect(new URL('/login?error=sso_incomplete_profile', appUrl))
  }

  const entity = await prisma.entity.findUnique({
    where: { workosOrganisationId: profile.organizationId },
    select: { id: true },
  })
  if (!entity) return NextResponse.redirect(new URL('/login?error=sso_unknown_org', appUrl))

  const email = profile.email.toLowerCase()
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || email

  // Auto-provision on first sign-in; reactivate if previously deprovisioned.
  const existing = await prisma.user.findUnique({ where: { email } })
  let userId: string
  if (existing) {
    userId = existing.id
    if (!existing.isActive) {
      await prisma.user.update({ where: { id: existing.id }, data: { isActive: true } })
    }
  } else {
    const created = await prisma.user.create({
      data: { email, name, entityId: entity.id, role: 'CONTRIBUTOR', isActive: true },
      select: { id: true },
    })
    userId = created.id
  }

  const token = mintSsoToken(userId)
  return NextResponse.redirect(new URL(`/sso/complete?token=${encodeURIComponent(token)}`, appUrl))
}
