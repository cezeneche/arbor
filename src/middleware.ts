import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const isAuthed = !!req.auth
  const isPublic =
    req.nextUrl.pathname.startsWith('/login') ||
    req.nextUrl.pathname.startsWith('/signup') ||
    req.nextUrl.pathname.startsWith('/submit') ||
    req.nextUrl.pathname.startsWith('/api/auth') ||
    req.nextUrl.pathname.startsWith('/api/submit') ||
    req.nextUrl.pathname.startsWith('/api/inngest')

  if (!isAuthed && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/inngest).*)'],
  // Note: /signup, /submit, /api/auth/signup, /api/submit are handled as public in the auth callback above
}
