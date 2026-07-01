// Paths reachable without an authenticated session. Everything here either
// renders a public/marketing page, is an auth entry point, or handles its own
// authentication (API key, Bearer token, or webhook signature). The routing
// middleware (proxy.ts) redirects all other unauthenticated requests to /login.
//
// Kept pure and dependency-free so the Edge-runtime middleware can import it
// without pulling in Prisma/bcrypt, and so the allowlist is unit-testable.

const PUBLIC_PREFIXES = [
  // Marketing + informational
  '/pricing',
  '/legal',
  '/security',
  '/docs',
  '/about',
  '/how-it-works',
  '/institutional',
  // Auth entry points
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/2fa-verify',
  '/sso',
  // Scoped supplier/buyer entry links
  '/submit',
  '/share',
  // Self-authenticating / public API routes
  '/api/legal',
  '/api/auth',
  '/api/submit',
  '/api/signup',
  '/api/inngest',
  '/api/inbound-email',
  '/api/workos',
  '/api/v1',
  '/api/query',
  '/api/records/convert',
  '/api/institutional',
  '/api/audit/verify-public',
  // Scheduled jobs — each route enforces its own CRON_SECRET Bearer auth.
  '/api/cron',
] as const

export function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true
  return PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix))
}
