import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { isSsoConfigured, getAuthorizationUrl } from '@/lib/sso/workos'

// start SSO: resolve the user's email to their organisation's WorkOS
// connection and redirect to the IdP. Falls back to /login when SSO is not set up.
export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const email = req.nextUrl.searchParams.get('email')?.toLowerCase()
  if (!email) return NextResponse.redirect(new URL('/login?error=sso_email_required', appUrl))

  if (!isSsoConfigured()) return NextResponse.redirect(new URL('/login?error=sso_unavailable', appUrl))

  const user = await prisma.user.findUnique({
    where: { email },
    select: { entity: { select: { workosOrganisationId: true } } },
  })
  const orgId = user?.entity?.workosOrganisationId
  if (!orgId) return NextResponse.redirect(new URL('/login?error=sso_not_configured', appUrl))

  // CSRF state: random value carried to the IdP and mirrored back on the callback,
  // pinned to the browser via an httpOnly cookie the callback re-checks.
  const state = randomBytes(16).toString('hex')
  const redirectUri = `${appUrl}/api/workos/callback`
  const res = NextResponse.redirect(getAuthorizationUrl(orgId, redirectUri, state))
  res.cookies.set('sso_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return res
}
