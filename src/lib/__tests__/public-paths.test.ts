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
