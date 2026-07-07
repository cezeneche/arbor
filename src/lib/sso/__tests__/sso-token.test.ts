import { mintSsoToken, verifySsoToken } from '../sso-token'

// one-time signed token bridging the WorkOS callback to the NextAuth
// session. HMAC-signed with an expiry; tamper- and replay-window-bounded.
const ORIGINAL = process.env.NEXTAUTH_SECRET
beforeAll(() => { process.env.NEXTAUTH_SECRET = 'test-nextauth-secret' })
afterAll(() => { process.env.NEXTAUTH_SECRET = ORIGINAL })

describe('SSO token', () => {
  it('round-trips a userId', () => {
    const token = mintSsoToken('usr_123')
    expect(verifySsoToken(token)).toBe('usr_123')
  })

  it('rejects a tampered token', () => {
    const token = mintSsoToken('usr_123')
    const tampered = token.slice(0, -4) + 'aaaa'
    expect(verifySsoToken(tampered)).toBeNull()
  })

  it('rejects a malformed token', () => {
    expect(verifySsoToken('garbage')).toBeNull()
    expect(verifySsoToken('')).toBeNull()
  })

  it('rejects an expired token', () => {
    const token = mintSsoToken('usr_123', Date.now() - 1000) // already expired
    expect(verifySsoToken(token)).toBeNull()
  })
})
