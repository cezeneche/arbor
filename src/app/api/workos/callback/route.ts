import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithCode } from '@/lib/sso/workos'
import { mintSsoToken } from '@/lib/sso/sso-token'
import { decideSsoProvisioning } from '@/lib/sso/provisioning'

// WorkOS callback. Exchanges the code, auto-provisions the user against
// the entity bound to the WorkOS organisation, then hands a one-time token to the
// client which completes NextAuth sign-in.
export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/login?error=sso_no_code', appUrl))

  // CSRF / session-fixation defence: the state set in /authorize must round-trip
  // through the IdP and match the httpOnly cookie. A missing or mismatched state
  // means a forged or replayed callback.
  const state = req.nextUrl.searchParams.get('state')
  const cookieState = req.cookies.get('sso_state')?.value
  if (!state || !cookieState || state !== cookieState) {
    const bad = NextResponse.redirect(new URL('/login?error=sso_state', appUrl))
    bad.cookies.set('sso_state', '', { maxAge: 0, path: '/' })
    return bad
  }

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

  // Auto-provision on first sign-in only. An email already held by another tenant
  // is not adopted, and a deprovisioned account is not silently reactivated —
  // see decideSsoProvisioning for why each of those is a rejection.
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, entityId: true, isActive: true },
  })
  const decision = decideSsoProvisioning(existing, entity.id)

  if (decision.action === 'REJECT') {
    const res = NextResponse.redirect(new URL(`/login?error=sso_${decision.reason}`, appUrl))
    res.cookies.set('sso_state', '', { maxAge: 0, path: '/' })
    return res
  }

  let userId: string
  if (decision.action === 'SIGN_IN') {
    userId = decision.userId
  } else {
    const created = await prisma.user.create({
      data: { email, name, entityId: entity.id, role: 'CONTRIBUTOR', isActive: true },
      select: { id: true },
    })
    userId = created.id
  }

  const token = await mintSsoToken(userId)
  const res = NextResponse.redirect(new URL(`/sso/complete?token=${encodeURIComponent(token)}`, appUrl))
  res.cookies.set('sso_state', '', { maxAge: 0, path: '/' }) // one-time state consumed
  return res
}
