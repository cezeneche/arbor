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
    req.nextUrl.pathname.startsWith('/login') ||
    req.nextUrl.pathname.startsWith('/signup') ||
    req.nextUrl.pathname.startsWith('/forgot-password') ||
    req.nextUrl.pathname.startsWith('/reset-password') ||
    req.nextUrl.pathname.startsWith('/2fa-verify') ||
    req.nextUrl.pathname.startsWith('/about') ||
    req.nextUrl.pathname.startsWith('/how-it-works') ||
    req.nextUrl.pathname.startsWith('/institutional') ||
    req.nextUrl.pathname.startsWith('/submit') ||
    req.nextUrl.pathname.startsWith('/api/auth') ||
    req.nextUrl.pathname.startsWith('/api/submit') ||
    req.nextUrl.pathname.startsWith('/api/signup') ||
    req.nextUrl.pathname.startsWith('/api/inngest') ||
    req.nextUrl.pathname.startsWith('/api/v1') ||
    req.nextUrl.pathname.startsWith('/api/query') ||
    req.nextUrl.pathname.startsWith('/api/records/convert') ||
    req.nextUrl.pathname.startsWith('/api/institutional')

  if (!isAuthed && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url))
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
