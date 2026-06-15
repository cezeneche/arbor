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
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/inngest).*)'],
}
