import NextAuth from 'next-auth'
import { authConfig } from '@/lib/auth.config'
import { NextResponse } from 'next/server'

// Create a middleware-only NextAuth instance using the Edge-safe config.
// This avoids pulling in Prisma or bcryptjs into the Edge runtime bundle.
const { auth } = NextAuth(authConfig)

export default auth((req) => {
  const isAuthed = !!req.auth
  const isPublic =
    req.nextUrl.pathname === '/' ||
    req.nextUrl.pathname.startsWith('/pricing') ||
    req.nextUrl.pathname.startsWith('/legal') ||
    req.nextUrl.pathname.startsWith('/security') ||
    req.nextUrl.pathname.startsWith('/docs') ||
    req.nextUrl.pathname.startsWith('/api/legal') ||
    req.nextUrl.pathname.startsWith('/login') ||
    req.nextUrl.pathname.startsWith('/signup') ||
    req.nextUrl.pathname.startsWith('/forgot-password') ||
    req.nextUrl.pathname.startsWith('/reset-password') ||
    req.nextUrl.pathname.startsWith('/2fa-verify') ||
    req.nextUrl.pathname.startsWith('/sso') ||
    req.nextUrl.pathname.startsWith('/about') ||
    req.nextUrl.pathname.startsWith('/how-it-works') ||
    req.nextUrl.pathname.startsWith('/institutional') ||
    req.nextUrl.pathname.startsWith('/submit') ||
    req.nextUrl.pathname.startsWith('/api/auth') ||
    req.nextUrl.pathname.startsWith('/api/submit') ||
    req.nextUrl.pathname.startsWith('/api/signup') ||
    req.nextUrl.pathname.startsWith('/api/inngest') ||
    req.nextUrl.pathname.startsWith('/api/inbound-email') ||
    req.nextUrl.pathname.startsWith('/api/workos') ||
    req.nextUrl.pathname.startsWith('/api/v1') ||
    req.nextUrl.pathname.startsWith('/api/query') ||
    req.nextUrl.pathname.startsWith('/api/records/convert') ||
    req.nextUrl.pathname.startsWith('/api/institutional') ||
    req.nextUrl.pathname.startsWith('/api/audit/verify-public')

  if (!isAuthed && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Gap 3/4 — route platform roles to their own areas and keep them out of the
  // entity portal (their session carries no entityId).
  const authedUser = (req.auth as unknown as { user?: Record<string, unknown> } | null)?.user
  const role = authedUser?.role as string | undefined
  const path = req.nextUrl.pathname
  if (isAuthed && role === 'VERIFIER') {
    const allowed = path.startsWith('/verifier') || path.startsWith('/api/verifier') || isPublic
    if (!allowed) return NextResponse.redirect(new URL('/verifier/assignments', req.url))
  }
  if (isAuthed && role === 'AUDITOR') {
    const allowed = path.startsWith('/auditor') || path.startsWith('/api/audit') || isPublic
    if (!allowed) return NextResponse.redirect(new URL('/auditor', req.url))
  }
  // Conversely, keep entity users out of the verifier/auditor areas.
  if (isAuthed && role && role !== 'VERIFIER' && (path.startsWith('/verifier') || path.startsWith('/api/verifier'))) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }
  if (isAuthed && role && role !== 'AUDITOR' && path.startsWith('/auditor')) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  // If authenticated but 2FA challenge is pending, keep the user on /2fa-verify.
  // Allow public routes and /2fa-verify itself through so the challenge page renders.
  const pending2fa = (req.auth as unknown as Record<string, unknown> | null)?.user
    ? ((req.auth as unknown as { user: Record<string, unknown> }).user.pending2fa as boolean)
    : false

  if (isAuthed && pending2fa && !req.nextUrl.pathname.startsWith('/2fa-verify') && !isPublic) {
    return NextResponse.redirect(new URL('/2fa-verify', req.url))
  }
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/inngest).*)'],
}
