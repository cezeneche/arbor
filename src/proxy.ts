import NextAuth from 'next-auth'
import { authConfig } from '@/lib/auth.config'
import { isPublicPath } from '@/lib/public-paths'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Create a middleware-only NextAuth instance using the Edge-safe config.
// This avoids pulling in Prisma or bcryptjs into the Edge runtime bundle.
const { auth } = NextAuth(authConfig)

// Build a redirect against the real external host. In middleware on Vercel,
// `req.url` can resolve to http://localhost:3000 (the internal address), which
// would send the browser to localhost. The forwarded host header carries the
// actual domain, so derive the base from it.
function redirectTo(req: NextRequest, path: string): NextResponse {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const base = host ? `${proto}://${host}` : req.nextUrl.origin
  return NextResponse.redirect(new URL(path, base))
}

export default auth((req) => {
  const isAuthed = !!req.auth
  const isPublic = isPublicPath(req.nextUrl.pathname)

  if (!isAuthed && !isPublic) {
    return redirectTo(req, '/login')
  }

  // Gap 3/4 — route platform roles to their own areas and keep them out of the
  // entity portal (their session carries no entityId).
  const authedUser = (req.auth as unknown as { user?: Record<string, unknown> } | null)?.user
  const role = authedUser?.role as string | undefined
  const path = req.nextUrl.pathname
  if (isAuthed && role === 'VERIFIER') {
    const allowed = path.startsWith('/verifier') || path.startsWith('/api/verifier') || isPublic
    if (!allowed) return redirectTo(req, '/verifier/assignments')
  }
  if (isAuthed && role === 'AUDITOR') {
    const allowed = path.startsWith('/auditor') || path.startsWith('/api/audit') || isPublic
    if (!allowed) return redirectTo(req, '/auditor')
  }
  // Conversely, keep entity users out of the verifier/auditor areas.
  if (isAuthed && role && role !== 'VERIFIER' && (path.startsWith('/verifier') || path.startsWith('/api/verifier'))) {
    return redirectTo(req, '/dashboard')
  }
  if (isAuthed && role && role !== 'AUDITOR' && path.startsWith('/auditor')) {
    return redirectTo(req, '/dashboard')
  }

  // If authenticated but 2FA challenge is pending, keep the user on /2fa-verify.
  // Allow public routes and /2fa-verify itself through so the challenge page renders.
  const pending2fa = (req.auth as unknown as Record<string, unknown> | null)?.user
    ? ((req.auth as unknown as { user: Record<string, unknown> }).user.pending2fa as boolean)
    : false

  if (isAuthed && pending2fa && !req.nextUrl.pathname.startsWith('/2fa-verify') && !isPublic) {
    return redirectTo(req, '/2fa-verify')
  }
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/inngest).*)'],
}
