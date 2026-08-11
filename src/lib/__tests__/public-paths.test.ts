import { isPublicPath } from '@/lib/public-paths'

// The routing middleware (proxy.ts) redirects any non-public, unauthenticated
// request to /login. Routes that handle their own auth (API key, Bearer token,
// webhook signature) MUST be public here, or the session check bounces them to
// the login page before their handler runs. This pins that allowlist.

describe('isPublicPath', () => {
  it('treats the marketing root and auth entry points as public', () => {
    expect(isPublicPath('/')).toBe(true)
    expect(isPublicPath('/login')).toBe(true)
    expect(isPublicPath('/pricing')).toBe(true)
  })

  it('treats self-authenticating API routes as public', () => {
    expect(isPublicPath('/api/v1/records')).toBe(true)
    expect(isPublicPath('/api/query')).toBe(true)
    // The calibration cron authenticates with a Bearer CRON_SECRET, not a session.
    expect(isPublicPath('/api/cron/calibrate')).toBe(true)
  })

  it('exposes the offline Merkle verifier (client-only, fetches no data)', () => {
    expect(isPublicPath('/verify-merkle')).toBe(true)
  })

  it('keeps session-guarded app and API routes private', () => {
    expect(isPublicPath('/dashboard')).toBe(false)
    expect(isPublicPath('/api/records')).toBe(false)
    expect(isPublicPath('/api/documents/abc/confirm')).toBe(false)
  })

  it('does not let a public prefix leak a private sibling', () => {
    // /api/records/convert is public; /api/records is not.
    expect(isPublicPath('/api/records/convert')).toBe(true)
    expect(isPublicPath('/api/records')).toBe(false)
  })
})

// Added after /supplier/[token] was found redirecting to /login in production.
//
// The CBAM supplier form is the one screen in the product whose entire audience
// has no account. The token IS the credential. Sending that audience to a login
// page makes the form unreachable by everyone it was built for, and the failure
// is invisible from inside the product — every signed-in tester sees it work.
describe('token-authenticated entry links reachable without an account', () => {
  it('lets a supplier open a CBAM emissions form', () => {
    expect(isPublicPath('/supplier/abc123')).toBe(true)
  })

  it('lets a supplier open a records submission link', () => {
    expect(isPublicPath('/submit/abc123')).toBe(true)
  })

  it('lets a buyer open a shared export', () => {
    expect(isPublicPath('/share/abc123')).toBe(true)
  })

  it('keeps the portal behind a session', () => {
    // The allowlist is prefix-based, so a careless entry opens more than it means to.
    expect(isPublicPath('/cbam')).toBe(false)
    expect(isPublicPath('/records')).toBe(false)
    expect(isPublicPath('/settings')).toBe(false)
  })

  it('does not open a portal path that merely starts with a public word', () => {
    expect(isPublicPath('/suppliers')).toBe(false)
  })
})
